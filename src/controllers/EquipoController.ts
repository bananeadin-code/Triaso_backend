import type { Request, Response } from 'express'
import Equipo, { IEquipo } from '../models/Equipo'
import Componente from '../models/Componente'
import { registrarHistorial } from '../services/historial'
import { diffPersonalizados, limpiarPersonalizados } from '../services/camposPersonalizados'
import { getCategoriasConfig } from '../models/Configuracion'
import { efectivo, mapaPrincipal } from '../services/moneda'

type LineaPlana = { componente: string; variacion: string; cantidad: number }
type CompInfo = { concepto: string; variaciones: Map<string, string> }

// Compara la composición (líneas) del equipo antes vs después.
function diffEquipoLineas(viejas: LineaPlana[], nuevas: LineaPlana[], compMap: Map<string, CompInfo>) {
    const cambios: string[] = []
    let sensible = false
    const key = (l: LineaPlana) => `${l.componente}|${l.variacion}`
    const oldMap = new Map(viejas.map((l) => [key(l), l]))
    const newMap = new Map(nuevas.map((l) => [key(l), l]))

    const nombre = (l: LineaPlana) => {
        const c = compMap.get(l.componente)
        const comp = c?.concepto ?? '(componente)'
        const varn = c?.variaciones.get(l.variacion) ?? '(variación)'
        return { comp, varn }
    }

    for (const l of viejas) {
        if (!newMap.has(key(l))) {
            const { comp, varn } = nombre(l)
            cambios.push(`Se quitó el componente "${comp}" (variación ${varn}) de la composición`)
            sensible = true
        }
    }
    for (const l of nuevas) {
        if (!oldMap.has(key(l))) {
            const { comp, varn } = nombre(l)
            cambios.push(`Se agregó el componente "${comp}" (variación ${varn}) a la composición`)
            sensible = true
        }
    }
    for (const l of nuevas) {
        const ol = oldMap.get(key(l))
        if (ol && ol.cantidad !== l.cantidad) {
            const { comp, varn } = nombre(l)
            cambios.push(`Componente "${comp}" (${varn}) cantidad: ${ol.cantidad} → ${l.cantidad}`)
        }
    }
    return { cambios, sensible }
}

// Construye la tabla BOM (líneas resueltas) y el resumen de costos por categoría.
export async function construirBOM(equipo: IEquipo) {
    const idsComponentes = equipo.lineas.map((l) => l.componente)
    const componentes = await Componente.find({ _id: { $in: idsComponentes } })
    const mapa = new Map(componentes.map((c) => [String(c._id), c]))

    // Moneda principal de cada material: un material cuesta en UNA sola moneda.
    const idsMat = componentes.flatMap((c) => c.variaciones.flatMap((v) => v.materiales.map((m) => m.material)))
    const principal = await mapaPrincipal(idsMat)

    // Categorías configuradas (nombre editable por la empresa)
    const cats = await getCategoriasConfig()
    // Acumulador del resumen por categoría
    const acumulado: Record<string, { mxn: number; usd: number }> = {}
    cats.forEach((c) => (acumulado[c.id] = { mxn: 0, usd: 0 }))
    let totalMXN = 0
    let totalUSD = 0

    const lineas = equipo.lineas.map((linea) => {
        const comp = mapa.get(String(linea.componente))
        const variacion = comp?.variaciones.find((v) => String(v._id) === String(linea.variacion))
        const factor = linea.cantidad || 1

        const materiales = (variacion?.materiales ?? []).map((m) => {
            // Solo la moneda principal cuesta; la otra es dato secundario (no se suma).
            const p = m.material ? principal.get(String(m.material)) ?? 'mxn' : m.costoUSD > 0 && !m.costoMXN ? 'usd' : 'mxn'
            const ef = efectivo(p, m.costoMXN, m.costoUSD)
            const cantEf = +(m.cantidad * factor).toFixed(4)
            const importeMXN = +(ef.mxn * cantEf).toFixed(2)
            const importeUSD = +(ef.usd * cantEf).toFixed(2)

            // Suma al resumen según la categoría (letra) del material
            if (acumulado[m.tipo]) {
                acumulado[m.tipo].mxn += importeMXN
                acumulado[m.tipo].usd += importeUSD
            }
            totalMXN += importeMXN
            totalUSD += importeUSD

            return {
                clave: m.clave,
                concepto: m.concepto,
                proveedor: m.proveedor?.codigo ?? '',
                tipo: m.tipo,
                // Cantidad EFECTIVA (× las unidades de la línea) para que cantidad × costo = importe,
                // igual que en la cotización. `cantidadUnitaria` conserva la de una sola unidad.
                cantidad: cantEf,
                cantidadUnitaria: m.cantidad,
                unidad: m.unidad,
                costoMXN: ef.mxn,
                costoUSD: ef.usd,
                paridad: m.paridad,
                importeMXN,
                importeUSD,
            }
        })

        return {
            lineaId: linea._id,
            componenteId: linea.componente,
            componente: comp?.concepto ?? '(componente eliminado)',
            variacionId: linea.variacion,
            variacion: variacion?.nombre ?? '(variación eliminada)',
            cantidad: factor,
            materiales,
        }
    })

    const porCategoria = cats.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        mxn: +acumulado[c.id].mxn.toFixed(2),
        usd: +acumulado[c.id].usd.toFixed(2),
    }))

    return {
        lineas,
        resumen: {
            porCategoria,
            totalGeneral: { mxn: +totalMXN.toFixed(2), usd: +totalUSD.toFixed(2) },
        },
    }
}

export class EquipoController {
    static obtenerEquipos = async (req: Request, res: Response) => {
        try {
            const equipos = await Equipo.find().sort({ nombre: 1 })
            const lista = equipos.map((e) => ({
                _id: e.id,
                nombre: e.nombre,
                tipo: e.tipo,
                descripcion: e.descripcion,
                activo: e.activo,
                totalLineas: e.lineas.length,
                personalizados: e.personalizados ?? {},
                porValidar: !!e.porValidar,
            }))
            res.json(lista)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener equipos' })
        }
    }

    // Devuelve el equipo con su BOM resuelto y el resumen de costos
    static obtenerEquipoPorId = async (req: Request, res: Response) => {
        try {
            const equipo = await Equipo.findById(req.params.id)
            if (!equipo) {
                return res.status(404).json({ error: 'Equipo no encontrado' })
            }
            const bom = await construirBOM(equipo)
            res.json({
                _id: equipo.id,
                nombre: equipo.nombre,
                tipo: equipo.tipo,
                descripcion: equipo.descripcion,
                activo: equipo.activo,
                personalizados: equipo.personalizados ?? {},
                ...bom,
            })
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener el equipo' })
        }
    }

    static crearEquipo = async (req: Request, res: Response) => {
        try {
            const { nombre, tipo, descripcion, lineas } = req.body
            const equipo = new Equipo({ nombre, tipo, descripcion, lineas: lineas ?? [] })
            equipo.personalizados = await limpiarPersonalizados('equipos', req.body.personalizados)
            await equipo.save()
            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'equipo',
                sector: 'bom',
                accion: 'creo',
                entidad: equipo.nombre,
                equipo: equipo._id as never,
                equipoNombre: equipo.nombre,
                cambios: ['Alta de equipo'],
            })
            res.status(201).json({ mensaje: 'Equipo creado correctamente', id: equipo.id })
        } catch (error) {
            res.status(500).json({ error: 'Error al crear el equipo' })
        }
    }

    static actualizarEquipo = async (req: Request, res: Response) => {
        try {
            const equipo = await Equipo.findById(req.params.id)
            if (!equipo) {
                return res.status(404).json({ error: 'Equipo no encontrado' })
            }
            // Snapshot de la composición ANTERIOR para el historial
            const lineasViejas: LineaPlana[] = equipo.lineas.map((l) => ({
                componente: String(l.componente),
                variacion: String(l.variacion),
                cantidad: l.cantidad,
            }))

            const { nombre, tipo, descripcion, lineas, activo } = req.body
            if (nombre !== undefined) equipo.nombre = nombre
            if (tipo !== undefined) equipo.tipo = tipo
            if (descripcion !== undefined) equipo.descripcion = descripcion
            if (activo !== undefined) equipo.activo = activo
            if (lineas !== undefined) equipo.lineas = lineas

            // Datos adicionales (informativos; se conservan los de campos ocultos)
            let cambiosPers: string[] = []
            if (req.body.personalizados !== undefined) {
                const persAntes = equipo.personalizados ?? {}
                equipo.personalizados = await limpiarPersonalizados('equipos', req.body.personalizados, persAntes)
                equipo.markModified('personalizados')
                cambiosPers = await diffPersonalizados('equipos', persAntes, equipo.personalizados)
            }

            await equipo.save()

            if (cambiosPers.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'equipo',
                    sector: 'bom',
                    accion: 'edito',
                    entidad: equipo.nombre,
                    equipo: equipo._id as never,
                    equipoNombre: equipo.nombre,
                    cambios: cambiosPers,
                })
            }

            // Historial: cambios a la composición del equipo (agregar/quitar componentes, variación, cantidad)
            if (lineas !== undefined) {
                const lineasNuevas: LineaPlana[] = equipo.lineas.map((l) => ({
                    componente: String(l.componente),
                    variacion: String(l.variacion),
                    cantidad: l.cantidad,
                }))
                const ids = [...new Set([...lineasViejas, ...lineasNuevas].map((l) => l.componente))]
                const comps = await Componente.find({ _id: { $in: ids } }).select('concepto variaciones')
                const compMap: Map<string, CompInfo> = new Map(
                    comps.map((c) => [
                        String(c._id),
                        {
                            concepto: c.concepto,
                            variaciones: new Map(c.variaciones.map((v) => [String(v._id), v.nombre])),
                        },
                    ])
                )

                const { cambios, sensible } = diffEquipoLineas(lineasViejas, lineasNuevas, compMap)
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'equipo',
                    sector: 'bom',
                    accion: 'edito',
                    entidad: equipo.nombre,
                    equipo: equipo._id as never,
                    equipoNombre: equipo.nombre,
                    equiposAfectados: [{ equipo: equipo._id as never, nombre: equipo.nombre }],
                    cambios,
                    sensible,
                })
            }

            res.json({ mensaje: 'Equipo actualizado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el equipo' })
        }
    }

    static eliminarEquipo = async (req: Request, res: Response) => {
        try {
            const equipo = await Equipo.findById(req.params.id)
            if (!equipo) {
                return res.status(404).json({ error: 'Equipo no encontrado' })
            }

            const nombre = equipo.nombre
            const totalLineas = equipo.lineas?.length ?? 0
            await equipo.deleteOne()

            // Historial CRÍTICO: la eliminación de un equipo es irreversible
            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'equipo',
                sector: 'bom',
                accion: 'elimino',
                entidad: nombre,
                equipoNombre: nombre,
                cambios: [
                    `Se ELIMINÓ el equipo "${nombre}" con toda su composición (${totalLineas} componente(s) en su BOM)`,
                ],
                sensible: true,
                critico: true,
            })

            res.json({ mensaje: 'Equipo eliminado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el equipo' })
        }
    }
}

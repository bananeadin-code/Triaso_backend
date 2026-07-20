import type { Request, Response } from 'express'
import Componente, { IVariacion } from '../models/Componente'
import Material from '../models/Material'
import Equipo from '../models/Equipo'
import { registrarHistorial } from '../services/historial'
import { sincMaterialesDesdeComponente } from '../services/sincronizarCostos'

// Compara variaciones/materiales antes vs después y devuelve una lista de cambios legibles.
function diffComponente(
    conceptoViejo: string,
    conceptoNuevo: string,
    viejas: IVariacion[],
    nuevas: IVariacion[]
): { cambios: string[]; sensible: boolean } {
    const cambios: string[] = []
    let sensible = false

    if (conceptoViejo !== conceptoNuevo) {
        cambios.push(`Nombre del componente: "${conceptoViejo}" → "${conceptoNuevo}"`)
    }

    const oldById = new Map(viejas.map((v) => [String(v._id), v]))
    const newById = new Map(nuevas.filter((v) => v._id).map((v) => [String(v._id), v]))

    // Variaciones eliminadas / agregadas (cambios sensibles)
    for (const v of viejas) {
        if (!newById.has(String(v._id))) {
            cambios.push(`Se eliminó la variación "${v.nombre}"`)
            sensible = true
        }
    }
    for (const v of nuevas) {
        if (!v._id || !oldById.has(String(v._id))) {
            cambios.push(`Se agregó la variación "${v.nombre}"`)
            sensible = true
        }
    }

    // Variaciones que existían antes y ahora: comparar detalle
    for (const nv of nuevas) {
        if (!nv._id) continue
        const ov = oldById.get(String(nv._id))
        if (!ov) continue
        if (ov.nombre !== nv.nombre) cambios.push(`Variación renombrada: "${ov.nombre}" → "${nv.nombre}"`)

        const key = (m: { material?: unknown; clave: string }) => String(m.material ?? m.clave)
        const oldMat = new Map((ov.materiales ?? []).map((m) => [key(m), m]))
        const newMat = new Map((nv.materiales ?? []).map((m) => [key(m), m]))

        for (const [k, om] of oldMat) {
            if (!newMat.has(k)) {
                cambios.push(`Se quitó ${om.clave || om.concepto} de "${nv.nombre}"`)
                sensible = true
            }
        }
        for (const [k, nm] of newMat) {
            if (!oldMat.has(k)) {
                cambios.push(`Se agregó ${nm.clave || nm.concepto} a "${nv.nombre}"`)
                sensible = true
            }
        }
        for (const [k, nm] of newMat) {
            const om = oldMat.get(k)
            if (!om) continue
            if (om.costoMXN !== nm.costoMXN) cambios.push(`${nm.clave} costo MXN: $${om.costoMXN} → $${nm.costoMXN}`)
            if (om.costoUSD !== nm.costoUSD) cambios.push(`${nm.clave} costo USD: $${om.costoUSD} → $${nm.costoUSD}`)
            if (om.tipo !== nm.tipo) cambios.push(`${nm.clave} categoría: ${om.tipo} → ${nm.tipo}`)
            if (om.cantidad !== nm.cantidad) cambios.push(`${nm.clave} cantidad: ${om.cantidad} → ${nm.cantidad}`)
        }
    }

    return { cambios, sensible }
}

// Normaliza las variaciones: enriquece snapshots desde el catálogo y calcula importes.
async function normalizarVariaciones(variaciones: IVariacion[]): Promise<IVariacion[]> {
    if (!Array.isArray(variaciones)) return []

    // Carga en lote los materiales referenciados para tomar snapshots
    const idsMateriales: string[] = variaciones
        .flatMap((v) => v.materiales ?? [])
        .map((m) => (m.material ? String(m.material) : ''))
        .filter((id) => id !== '')

    const materiales = await Material.find({ _id: { $in: idsMateriales } }).populate(
        'proveedorPrincipal',
        'codigo razonSocial'
    )
    const mapa = new Map(materiales.map((m) => [String(m._id), m]))

    return variaciones.map((v) => ({
        // Conserva el _id de la variación para no romper las referencias del BOM de los equipos
        ...(v._id ? { _id: v._id } : {}),
        nombre: v.nombre?.trim() || 'Estándar',
        materiales: (v.materiales ?? []).map((m) => {
            const ref = m.material ? mapa.get(String(m.material)) : undefined
            const prov = ref?.proveedorPrincipal as unknown as
                | { _id: unknown; codigo: string; razonSocial: string }
                | undefined

            const cantidad = Number(m.cantidad) || 0
            const costoMXN = Number(m.costoMXN) || 0
            const costoUSD = Number(m.costoUSD) || 0

            return {
                ...(m._id ? { _id: m._id } : {}),
                material: m.material,
                clave: m.clave || ref?.clave || '',
                concepto: m.concepto || ref?.concepto || '',
                proveedor: m.proveedor?.codigo
                    ? m.proveedor
                    : prov
                      ? { proveedor: prov._id as never, codigo: prov.codigo, razonSocial: prov.razonSocial }
                      : { codigo: '', razonSocial: '' },
                tipo: m.tipo || ref?.categoriaPrincipal || 'A',
                cantidad,
                unidad: m.unidad || 'Pieza',
                costoMXN,
                costoUSD,
                paridad: Number(m.paridad) || 0,
                importeMXN: +(cantidad * costoMXN).toFixed(2),
                importeUSD: +(cantidad * costoUSD).toFixed(2),
            }
        }),
    }))
}

export class ComponenteController {
    static obtenerComponentes = async (req: Request, res: Response) => {
        try {
            const componentes = await Componente.find().sort({ concepto: 1 })
            res.json(componentes)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener componentes' })
        }
    }

    static obtenerComponentePorId = async (req: Request, res: Response) => {
        try {
            const componente = await Componente.findById(req.params.id)
            if (!componente) {
                return res.status(404).json({ error: 'Componente no encontrado' })
            }
            res.json(componente)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener el componente' })
        }
    }

    static crearComponente = async (req: Request, res: Response) => {
        try {
            const { concepto, descripcion, variaciones } = req.body

            const variacionesNorm = await normalizarVariaciones(variaciones)
            // Garantiza al menos una variación
            if (variacionesNorm.length === 0) {
                variacionesNorm.push({ nombre: 'Estándar', materiales: [] })
            }

            const componente = new Componente({ concepto, descripcion, variaciones: variacionesNorm })
            await componente.save()
            res.status(201).json({ mensaje: 'Componente creado correctamente', id: componente.id })
        } catch (error) {
            res.status(500).json({ error: 'Error al crear el componente' })
        }
    }

    static actualizarComponente = async (req: Request, res: Response) => {
        try {
            const componente = await Componente.findById(req.params.id)
            if (!componente) {
                return res.status(404).json({ error: 'Componente no encontrado' })
            }

            // Snapshot del estado ANTERIOR para el historial
            const conceptoViejo = componente.concepto
            const variacionesViejas = componente.toObject().variaciones as IVariacion[]

            const { concepto, descripcion, variaciones, activo } = req.body
            if (concepto !== undefined) componente.concepto = concepto
            if (descripcion !== undefined) componente.descripcion = descripcion
            if (activo !== undefined) componente.activo = activo

            let variacionesNuevas: IVariacion[] | null = null
            if (variaciones !== undefined) {
                variacionesNuevas = await normalizarVariaciones(variaciones)
                componente.variaciones = variacionesNuevas
            }

            await componente.save()

            // Empareja el catálogo maestro con los costos editados en el componente
            // y propaga a los demás componentes que usan los mismos materiales.
            if (variacionesNuevas) {
                await sincMaterialesDesdeComponente(variacionesNuevas)
            }

            // Registro de historial (solo si hubo cambios en variaciones/concepto)
            if (variacionesNuevas) {
                const { cambios, sensible } = diffComponente(
                    conceptoViejo,
                    componente.concepto,
                    variacionesViejas,
                    variacionesNuevas
                )
                if (cambios.length > 0) {
                    const equipos = await Equipo.find({ 'lineas.componente': componente._id }).select('nombre')
                    await registrarHistorial({
                        usuario: req.usuario?.nombre ?? 'Sistema',
                        tipo: 'componente',
                        componente: componente._id as never,
                        componenteConcepto: componente.concepto,
                        equiposAfectados: equipos.map((e) => ({ equipo: e._id as never, nombre: e.nombre })),
                        cambios,
                        sensible,
                    })
                }
            }

            res.json({ mensaje: 'Componente actualizado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el componente' })
        }
    }

    static eliminarComponente = async (req: Request, res: Response) => {
        try {
            const componente = await Componente.findById(req.params.id)
            if (!componente) {
                return res.status(404).json({ error: 'Componente no encontrado' })
            }
            await componente.deleteOne()
            res.json({ mensaje: 'Componente eliminado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el componente' })
        }
    }
}

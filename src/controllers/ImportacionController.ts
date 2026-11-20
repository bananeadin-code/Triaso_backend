import type { Request, Response } from 'express'
import ImportacionLote from '../models/ImportacionLote'
import Material from '../models/Material'
import Proveedor from '../models/Proveedor'
import Componente from '../models/Componente'
import Equipo from '../models/Equipo'
import { registrarHistorial } from '../services/historial'
import { analizarBOM, aplicarBOM, bloqueosDeshacer, deshacerLote, type ArchivoBOM, type Decisiones } from '../services/importacionBOM'
import { puedeOperacion, type Rol } from '../config/permisos'

const MAX_SECCIONES = 3000
const MAX_FILAS = 30000
const txt = (v: unknown, max = 300) => String(v ?? '').slice(0, max)
const num = (v: unknown) => (isNaN(Number(v)) ? 0 : Number(v))

// El archivo llega ya leído por el navegador: se valida su forma y se recortan textos
function leerArchivo(body: unknown): ArchivoBOM {
    const b = (body ?? {}) as Record<string, unknown>
    const a = (b.archivo ?? {}) as Record<string, unknown>
    const secciones = Array.isArray(a.secciones) ? a.secciones : []
    if (!secciones.length) throw Object.assign(new Error('El archivo no trae secciones'), { status: 400 })
    if (secciones.length > MAX_SECCIONES) throw Object.assign(new Error('El archivo tiene demasiadas secciones'), { status: 400 })
    let total = 0
    const out: ArchivoBOM = {
        archivo: txt(a.archivo, 200),
        equipo: {
            clave: txt((a.equipo as Record<string, unknown>)?.clave, 120),
            nombre: txt((a.equipo as Record<string, unknown>)?.nombre, 300),
            observaciones: txt((a.equipo as Record<string, unknown>)?.observaciones, 500),
        },
        secciones: secciones.map((s) => {
            const sec = s as Record<string, unknown>
            const filas = Array.isArray(sec.filas) ? sec.filas : []
            total += filas.length
            return {
                nombre: txt(sec.nombre, 150),
                filas: filas.map((f) => {
                    const r = f as Record<string, unknown>
                    return {
                        clave: txt(r.clave, 40),
                        concepto: txt(r.concepto, 300),
                        proveedor: txt(r.proveedor, 60),
                        tipo: txt(r.tipo, 10),
                        cantidad: Math.max(0, num(r.cantidad)),
                        unidad: txt(r.unidad, 30),
                        pesos: Math.max(0, num(r.pesos)),
                        dolares: Math.max(0, num(r.dolares)),
                        paridad: Math.max(0, num(r.paridad)),
                    }
                }),
            }
        }),
        sumas:
            a.sumas && typeof a.sumas === 'object'
                ? Object.fromEntries(Object.entries(a.sumas as Record<string, unknown>).map(([k, v]) => [txt(k, 10), num(v)]))
                : undefined,
    }
    if (total > MAX_FILAS) throw Object.assign(new Error('El archivo tiene demasiados renglones'), { status: 400 })
    return out
}

const decisiones = (body: unknown): Decisiones => ((body as Record<string, unknown>)?.decisiones ?? {}) as Decisiones

function responderError(res: Response, error: unknown, fallback: string) {
    const e = error as Error & { status?: number; bloqueos?: string[] }
    if (e.bloqueos) return res.status(409).json({ error: e.message, bloqueos: e.bloqueos })
    if (e.status) return res.status(e.status).json({ error: e.message })
    return res.status(500).json({ error: fallback })
}

export class ImportacionController {
    // Concilia el archivo contra los catálogos SIN escribir nada (se llama en cada cambio de la revisión)
    static analizarBOM = async (req: Request, res: Response) => {
        try {
            res.json(await analizarBOM(leerArchivo(req.body), decisiones(req.body)))
        } catch (error) {
            responderError(res, error, 'Error al analizar el archivo')
        }
    }

    static aplicarBOM = async (req: Request, res: Response) => {
        try {
            const { lote, equipoId } = await aplicarBOM(leerArchivo(req.body), decisiones(req.body), req.usuario?.nombre ?? 'Sistema')
            res.status(201).json({ mensaje: `Importación ${lote.folio} aplicada`, folio: lote.folio, id: lote.id, equipoId, resumen: lote.resumen })
        } catch (error) {
            responderError(res, error, 'Error al aplicar la importación')
        }
    }

    static listarLotes = async (req: Request, res: Response) => {
        try {
            const lotes = await ImportacionLote.find().sort({ createdAt: -1 }).limit(100).lean()
            res.json(
                lotes.map((l) => ({
                    _id: String(l._id),
                    folio: l.folio,
                    archivo: l.archivo,
                    equipoNombre: l.equipoNombre,
                    usuario: l.usuario,
                    estado: l.estado,
                    resumen: l.resumen,
                    deshechoPor: l.deshechoPor,
                    createdAt: (l as unknown as { createdAt: Date }).createdAt,
                }))
            )
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener las importaciones' })
        }
    }

    // ¿Se puede deshacer? (para avisar en la pantalla antes de intentarlo)
    static revisarDeshacer = async (req: Request, res: Response) => {
        try {
            const lote = await ImportacionLote.findById(req.params.id)
            if (!lote) return res.status(404).json({ error: 'Lote no encontrado' })
            res.json({ bloqueos: lote.estado === 'aplicado' ? await bloqueosDeshacer(lote) : [`El lote está ${lote.estado}`] })
        } catch (error) {
            res.status(500).json({ error: 'Error al revisar el lote' })
        }
    }

    static deshacer = async (req: Request, res: Response) => {
        try {
            const lote = await deshacerLote(String(req.params.id), req.usuario?.nombre ?? 'Sistema')
            res.json({ mensaje: `Importación ${lote.folio} deshecha` })
        } catch (error) {
            responderError(res, error, 'Error al deshacer la importación')
        }
    }

    // Marca registros "por validar" como revisados. Requiere poder EDITAR ese catálogo.
    static validar = async (req: Request, res: Response) => {
        try {
            const modulo = String(req.body.modulo)
            const MODELOS = { materiales: Material, proveedores: Proveedor, componentes: Componente, equipos: Equipo } as const
            if (!(modulo in MODELOS)) return res.status(400).json({ error: 'Catálogo no válido' })
            const u = req.usuario!
            if (!puedeOperacion({ rol: u.rol as Rol, accesosPersonalizados: u.accesosPersonalizados, accesos: u.accesos }, modulo as 'materiales', 'editar'))
                return res.status(403).json({ error: `No tienes permiso para editar ${modulo}` })
            const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter((x: string) => /^[a-f\d]{24}$/i.test(x)) : []
            if (!ids.length) return res.status(400).json({ error: 'No se indicó qué validar' })
            const Modelo = MODELOS[modulo as keyof typeof MODELOS] as unknown as typeof Material
            const r = await Modelo.updateMany({ _id: { $in: ids }, porValidar: true }, { porValidar: false })
            if (r.modifiedCount > 0)
                await registrarHistorial({
                    usuario: u.nombre,
                    tipo: 'importacion',
                    sector: 'catalogos',
                    accion: 'edito',
                    entidad: `Validación de ${modulo}`,
                    cambios: [`${r.modifiedCount} registro(s) de ${modulo} revisados y marcados como validados`],
                })
            res.json({ mensaje: `${r.modifiedCount} registro(s) validados`, validados: r.modifiedCount })
        } catch (error) {
            res.status(500).json({ error: 'Error al validar' })
        }
    }
}

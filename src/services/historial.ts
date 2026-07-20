import { Types } from 'mongoose'
import Historial from '../models/Historial'
import Componente from '../models/Componente'
import Equipo from '../models/Equipo'

// Máximo de registros que se conservan (los más recientes). Fuente única: la usan
// el podado al registrar y el límite de lectura del HistorialController.
export const MAX_REGISTROS = 50

export interface DatosHistorial {
    usuario?: string
    tipo: 'componente' | 'equipo' | 'material'
    componente?: Types.ObjectId | string
    componenteConcepto?: string
    equipo?: Types.ObjectId | string
    equipoNombre?: string
    material?: Types.ObjectId | string
    materialClave?: string
    materialConcepto?: string
    equiposAfectados?: { equipo?: Types.ObjectId | string; nombre: string }[]
    cambios: string[]
    sensible?: boolean
    critico?: boolean
}

// Crea el registro y conserva solo los MAX_REGISTROS más recientes.
export async function registrarHistorial(datos: DatosHistorial) {
    if (!datos.cambios || datos.cambios.length === 0) return
    await Historial.create({ usuario: 'Sistema', ...datos } as never)

    const sobrantes = await Historial.find().sort({ createdAt: -1 }).skip(MAX_REGISTROS).select('_id')
    if (sobrantes.length > 0) {
        await Historial.deleteMany({ _id: { $in: sobrantes.map((s) => s._id) } })
    }
}

// Equipos afectados por un material: material -> componentes que lo usan -> equipos que los incluyen
export async function equiposAfectadosPorMaterial(materialId: Types.ObjectId | string) {
    const comps = await Componente.find({ 'variaciones.materiales.material': materialId }).select('_id')
    if (comps.length === 0) return []
    const equipos = await Equipo.find({ 'lineas.componente': { $in: comps.map((c) => c._id) } }).select('nombre')
    return equipos.map((e) => ({ equipo: e._id, nombre: e.nombre }))
}

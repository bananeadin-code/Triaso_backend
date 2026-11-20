import { Types } from 'mongoose'
import Historial, { AccionHistorial, SectorHistorial, TipoHistorial } from '../models/Historial'
import Componente from '../models/Componente'
import Equipo from '../models/Equipo'

// Máximo de registros que se conservan POR SECTOR (los más recientes de cada uno).
// Cada sector poda su propio historial, así uno ruidoso no desplaza al de otro.
export const MAX_POR_SECTOR = 50

export interface DatosHistorial {
    usuario?: string
    tipo: TipoHistorial
    sector?: SectorHistorial
    accion?: AccionHistorial
    entidad?: string
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

// Sector por defecto según el tipo (por si el llamador no lo especifica)
const SECTOR_POR_TIPO: Record<TipoHistorial, SectorHistorial> = {
    componente: 'catalogos',
    material: 'catalogos',
    proveedor: 'catalogos',
    equipo: 'bom',
    importacion: 'catalogos',
    usuario: 'sistema',
    sistema: 'sistema',
}

// Crea el registro y conserva solo los MAX_POR_SECTOR más recientes DE ESE SECTOR.
export async function registrarHistorial(datos: DatosHistorial) {
    if (!datos.cambios || datos.cambios.length === 0) return
    const sector = datos.sector ?? SECTOR_POR_TIPO[datos.tipo] ?? 'catalogos'
    await Historial.create({ usuario: 'Sistema', ...datos, sector } as never)

    const sobrantes = await Historial.find({ sector }).sort({ createdAt: -1 }).skip(MAX_POR_SECTOR).select('_id')
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

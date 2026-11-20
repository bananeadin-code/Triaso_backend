import mongoose, { Document, Schema, Types } from 'mongoose'

// Sectores para agrupar/filtrar la bitácora (mismos grupos que el menú)
export type SectorHistorial = 'catalogos' | 'bom' | 'compras' | 'inventario' | 'sistema'
export type AccionHistorial = 'creo' | 'edito' | 'elimino' | 'importo'
export type TipoHistorial = 'componente' | 'equipo' | 'material' | 'proveedor' | 'importacion' | 'usuario' | 'sistema'

// Registro AUDITABLE de un cambio en el sistema (altas, ediciones, bajas e importaciones
// en todos los módulos). Es la bitácora de "quién tocó qué dato".
export interface IHistorial extends Document {
    usuario: string // nombre del responsable (snapshot)
    tipo: TipoHistorial // qué clase de registro
    sector: SectorHistorial // para el banner de filtros
    accion: AccionHistorial // verbo de la acción
    entidad: string // nombre corto de lo afectado (código de proveedor, clave de material, etc.)
    componente?: Types.ObjectId
    componenteConcepto: string
    equipo?: Types.ObjectId
    equipoNombre: string
    material?: Types.ObjectId
    materialClave: string
    materialConcepto: string
    equiposAfectados: { equipo?: Types.ObjectId; nombre: string }[]
    cambios: string[] // lista de cambios "detalle: antes → ahora" o resumen
    sensible: boolean // cambio fuerte (agregó/eliminó variación o componente, costo global, etc.)
    critico: boolean // cambio irreversible (eliminación de un equipo)
}

const HistorialSchema: Schema = new Schema(
    {
        usuario: { type: String, default: 'Sistema' },
        tipo: {
            type: String,
            enum: ['componente', 'equipo', 'material', 'proveedor', 'importacion', 'usuario', 'sistema'],
            default: 'componente',
        },
        sector: {
            type: String,
            enum: ['catalogos', 'bom', 'compras', 'inventario', 'sistema'],
            default: 'catalogos',
        },
        accion: { type: String, enum: ['creo', 'edito', 'elimino', 'importo'], default: 'edito' },
        entidad: { type: String, default: '' },
        componente: { type: Schema.Types.ObjectId, ref: 'Componente' },
        componenteConcepto: { type: String, default: '' },
        equipo: { type: Schema.Types.ObjectId, ref: 'Equipo' },
        equipoNombre: { type: String, default: '' },
        material: { type: Schema.Types.ObjectId, ref: 'Material' },
        materialClave: { type: String, default: '' },
        materialConcepto: { type: String, default: '' },
        equiposAfectados: [
            {
                _id: false,
                equipo: { type: Schema.Types.ObjectId, ref: 'Equipo' },
                nombre: { type: String, default: '' },
            },
        ],
        cambios: { type: [String], default: [] },
        sensible: { type: Boolean, default: false },
        critico: { type: Boolean, default: false },
    },
    { timestamps: true }
)

// Índices: la bitácora se consulta por sector y siempre de lo más reciente a lo más viejo
HistorialSchema.index({ sector: 1, createdAt: -1 })
HistorialSchema.index({ createdAt: -1 })

const Historial = mongoose.model<IHistorial>('Historial', HistorialSchema)
export default Historial

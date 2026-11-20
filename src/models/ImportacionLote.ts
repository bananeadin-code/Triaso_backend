import mongoose, { Document, Schema, Types } from 'mongoose'

// Un LOTE de importación = una carga de Excel aplicada al sistema. Guarda exactamente qué
// creó y qué modificó, para trazabilidad ("¿de dónde salió este material?") y para poder
// DESHACER el lote completo si algo salió mal.
export type EstadoLote = 'aplicando' | 'aplicado' | 'deshecho' | 'fallido'

export interface IImportacionLote extends Document {
    folio: string // IMP0001
    tipo: 'bom'
    archivo: string // nombre del archivo de Excel
    equipoNombre: string
    usuario: string
    estado: EstadoLote
    resumen: string[]
    creados: {
        equipos: Types.ObjectId[]
        componentes: Types.ObjectId[]
        materiales: Types.ObjectId[]
        proveedores: Types.ObjectId[]
    }
    // Variaciones agregadas a componentes que YA existían
    variacionesAgregadas: { componente: Types.ObjectId; variacion: Types.ObjectId }[]
    // Composición anterior de un equipo existente que el lote reemplazó
    equipoReemplazado?: { equipo: Types.ObjectId; lineasAntes: unknown[] }
    // Precios anteriores de materiales existentes que el lote actualizó
    preciosAntes: { material: Types.ObjectId; costoUnitario: number; costoUSD: number }[]
    unidadesAgregadas: string[]
    deshechoPor: string
    deshechoAt?: Date
}

const ImportacionLoteSchema = new Schema<IImportacionLote>(
    {
        folio: { type: String, required: true, unique: true },
        tipo: { type: String, enum: ['bom'], default: 'bom' },
        archivo: { type: String, default: '' },
        equipoNombre: { type: String, default: '' },
        usuario: { type: String, default: '' },
        estado: { type: String, enum: ['aplicando', 'aplicado', 'deshecho', 'fallido'], default: 'aplicando' },
        resumen: { type: [String], default: [] },
        creados: {
            equipos: [{ type: Schema.Types.ObjectId, ref: 'Equipo' }],
            componentes: [{ type: Schema.Types.ObjectId, ref: 'Componente' }],
            materiales: [{ type: Schema.Types.ObjectId, ref: 'Material' }],
            proveedores: [{ type: Schema.Types.ObjectId, ref: 'Proveedor' }],
        },
        variacionesAgregadas: [
            { _id: false, componente: { type: Schema.Types.ObjectId, ref: 'Componente' }, variacion: Schema.Types.ObjectId },
        ],
        equipoReemplazado: {
            equipo: { type: Schema.Types.ObjectId, ref: 'Equipo' },
            lineasAntes: { type: [Schema.Types.Mixed], default: undefined },
        },
        preciosAntes: [
            { _id: false, material: { type: Schema.Types.ObjectId, ref: 'Material' }, costoUnitario: Number, costoUSD: Number },
        ],
        unidadesAgregadas: { type: [String], default: [] },
        deshechoPor: { type: String, default: '' },
        deshechoAt: { type: Date },
    },
    { timestamps: true }
)

ImportacionLoteSchema.index({ createdAt: -1 })

const ImportacionLote = mongoose.model<IImportacionLote>('ImportacionLote', ImportacionLoteSchema)
export default ImportacionLote

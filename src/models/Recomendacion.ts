import mongoose, { Document, Schema, Types } from 'mongoose'

// Una recomendación de orden a un proveedor alternativo, derivada de los
// faltantes de una orden ya enviada.
export interface IRecItem {
    material?: Types.ObjectId
    clave: string
    concepto: string
    cantidad: number
}

export interface IRecomendacion extends Document {
    ordenOrigen: Types.ObjectId
    folioOrigen: string
    proveedor: Types.ObjectId
    proveedorSnap: { codigo: string; razonSocial: string; email: string }
    items: IRecItem[]
    estado: 'pendiente' | 'finalizada' | 'eliminada'
    ordenGenerada?: Types.ObjectId
}

const RecItemSchema = new Schema<IRecItem>(
    {
        material: { type: Schema.Types.ObjectId, ref: 'Material' },
        clave: { type: String, default: '' },
        concepto: { type: String, default: '' },
        cantidad: { type: Number, default: 0 },
    },
    { _id: false }
)

const RecomendacionSchema: Schema = new Schema(
    {
        ordenOrigen: { type: Schema.Types.ObjectId, ref: 'OrdenCompra', required: true },
        folioOrigen: { type: String, default: '' },
        proveedor: { type: Schema.Types.ObjectId, ref: 'Proveedor', required: true },
        proveedorSnap: {
            codigo: { type: String, default: '' },
            razonSocial: { type: String, default: '' },
            email: { type: String, default: '' },
        },
        items: { type: [RecItemSchema], default: [] },
        estado: { type: String, enum: ['pendiente', 'finalizada', 'eliminada'], default: 'pendiente' },
        ordenGenerada: { type: Schema.Types.ObjectId, ref: 'OrdenCompra' },
    },
    { timestamps: true }
)

const Recomendacion = mongoose.model<IRecomendacion>('Recomendacion', RecomendacionSchema)
export default Recomendacion

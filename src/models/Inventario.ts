import mongoose, { Document, Schema, Types } from 'mongoose'

// Un renglón de inventario = un material del catálogo maestro que SÍ está en el almacén,
// con su stock actual y su ubicación (nota abierta). Clave y concepto se toman del material.
export interface IInventario extends Document {
    material: Types.ObjectId
    cantidad: number // stock actual
    ubicacion: string // nota de ubicación dentro del almacén
}

const InventarioSchema: Schema = new Schema(
    {
        material: {
            type: Schema.Types.ObjectId,
            ref: 'Material',
            required: true,
            unique: true, // un solo renglón de inventario por material
        },
        cantidad: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        ubicacion: {
            type: String,
            trim: true,
            default: '',
        },
    },
    { timestamps: true }
)

const Inventario = mongoose.model<IInventario>('Inventario', InventarioSchema)
export default Inventario

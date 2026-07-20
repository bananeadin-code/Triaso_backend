import mongoose, { Document, Schema, Types } from 'mongoose'
import { CATEGORIA_IDS } from '../config/categorias'

export interface IMaterial extends Document {
    clave: string // autogenerada, ej. EL0001
    concepto: string // nombre del material
    categoriaPrincipal: string // id A-E (única); define el prefijo de la clave
    proveedorPrincipal: Types.ObjectId
    proveedoresAsociados: Types.ObjectId[]
    // Costos unitarios (mismos campos que el material asignado a un componente, para sincronizar)
    costoUnitario: number // costo unitario en MXN
    costoUSD: number // costo unitario en USD
    importeMXN: number // importe unitario MXN (= costoUnitario)
    importeUSD: number // importe unitario USD (= costoUSD)
    activo: boolean
}
// Nota: la ubicación en almacén vive en el módulo de Inventario, no aquí.
// Las categorías adicionales se asignan al usar el material en un componente (campo tipo).

const MaterialSchema: Schema = new Schema(
    {
        clave: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
        },
        concepto: {
            type: String,
            required: true,
            trim: true,
        },
        categoriaPrincipal: {
            type: String,
            enum: CATEGORIA_IDS,
            required: true,
        },
        proveedorPrincipal: {
            type: Schema.Types.ObjectId,
            ref: 'Proveedor',
            required: true,
        },
        proveedoresAsociados: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Proveedor',
            },
        ],
        costoUnitario: {
            type: Number,
            required: true,
            min: 0,
        },
        costoUSD: { type: Number, default: 0, min: 0 },
        importeMXN: { type: Number, default: 0 },
        importeUSD: { type: Number, default: 0 },
        activo: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
)

const Material = mongoose.model<IMaterial>('Material', MaterialSchema)
export default Material

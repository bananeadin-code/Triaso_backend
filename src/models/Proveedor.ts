import mongoose, { Document, Schema } from 'mongoose'

export interface IProveedor extends Document {
    codigo: string // abreviado y manual, ej. "ISSSTE"
    razonSocial: string // nombre completo
    rfc?: string
    direccion?: string
    telefono?: string
    email?: string
    activo: boolean
}

const ProveedorSchema: Schema = new Schema(
    {
        codigo: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
        },
        razonSocial: {
            type: String,
            required: true,
            trim: true,
        },
        rfc: {
            type: String,
            uppercase: true,
            trim: true,
            default: '',
        },
        direccion: {
            type: String,
            trim: true,
            default: '',
        },
        telefono: {
            type: String,
            trim: true,
            default: '',
        },
        email: {
            type: String,
            lowercase: true,
            trim: true,
            default: '',
        },
        activo: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
)

const Proveedor = mongoose.model<IProveedor>('Proveedor', ProveedorSchema)
export default Proveedor

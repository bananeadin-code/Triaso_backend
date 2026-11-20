import mongoose, { Document, Schema, Types } from 'mongoose'

export interface IProveedor extends Document {
    codigo: string // abreviado y manual, ej. "ISSSTE"
    razonSocial: string // nombre completo / beneficiario fiscal
    rfc?: string
    direccion?: string
    contacto?: string // persona de contacto
    telefono?: string
    email?: string
    // Datos bancarios para el pago (formato real de Triaso)
    cuenta?: string // número de cuenta
    clabe?: string // CLABE interbancaria
    banco?: string // nombre del banco
    referencia?: string // referencia de pago (opcional)
    activo: boolean
    porValidar: boolean // creado por una importación, pendiente de revisión
    lote?: Types.ObjectId // lote de importación que lo creó
    personalizados: Record<string, unknown> // campos personalizados (informativos, ver Configuración)
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
        contacto: {
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
        cuenta: { type: String, trim: true, default: '' },
        clabe: { type: String, trim: true, default: '' },
        banco: { type: String, trim: true, default: '' },
        referencia: { type: String, trim: true, default: '' },
        activo: {
            type: Boolean,
            default: true,
        },
        // Alta hecha por una importación y aún no revisada por una persona (se marca en el catálogo)
        porValidar: { type: Boolean, default: false },
        lote: { type: Schema.Types.ObjectId, ref: 'ImportacionLote' },
        personalizados: { type: Schema.Types.Mixed, default: {} },
    },
    { timestamps: true }
)

const Proveedor = mongoose.model<IProveedor>('Proveedor', ProveedorSchema)
export default Proveedor

import mongoose, { Document, Schema, Types } from 'mongoose'

export type EstadoOrden = 'borrador' | 'enviada' | 'confirmada' | 'cancelada'

// Renglón de material dentro de la orden
export interface IOrdenItem {
    _id?: Types.ObjectId
    material?: Types.ObjectId
    clave: string // snapshot
    concepto: string // snapshot
    cantidad: number
    costoUnitario: number
    importe: number // cantidad * costoUnitario
}

// Snapshot fiscal del proveedor (para el ticket/factura)
export interface IProveedorFiscal {
    proveedor?: Types.ObjectId
    codigo: string
    razonSocial: string
    rfc: string
    direccion: string
    email: string
}

// Faltante marcado tras enviar la orden
export interface IFaltante {
    material?: Types.ObjectId
    clave: string
    concepto: string
    cantidad: number
}

export interface IOrdenCompra extends Document {
    folio: string // autogenerado, ej. OC0001
    proveedor: Types.ObjectId
    proveedorSnap: IProveedorFiscal
    items: IOrdenItem[]
    estado: EstadoOrden
    presupuestoEstimado: number // total estimado editable
    costoRealTotal: number // confirmado al recibir
    faltantes: IFaltante[]
    correoEnviado: boolean
    ordenOrigen?: Types.ObjectId // si nació de una recomendación de otra orden
    cotizacion?: Types.ObjectId // si nació de una cotización
    folioCotizacion: string // folio de la cotización origen (snapshot)
    notas: string
    enviadaAt?: Date
    confirmadaAt?: Date
}

const OrdenItemSchema = new Schema<IOrdenItem>(
    {
        material: { type: Schema.Types.ObjectId, ref: 'Material' },
        clave: { type: String, default: '' },
        concepto: { type: String, required: true },
        cantidad: { type: Number, required: true, min: 0 },
        costoUnitario: { type: Number, default: 0, min: 0 },
        importe: { type: Number, default: 0 },
    },
    { _id: true }
)

const ProveedorFiscalSchema = new Schema<IProveedorFiscal>(
    {
        proveedor: { type: Schema.Types.ObjectId, ref: 'Proveedor' },
        codigo: { type: String, default: '' },
        razonSocial: { type: String, default: '' },
        rfc: { type: String, default: '' },
        direccion: { type: String, default: '' },
        email: { type: String, default: '' },
    },
    { _id: false }
)

const FaltanteSchema = new Schema<IFaltante>(
    {
        material: { type: Schema.Types.ObjectId, ref: 'Material' },
        clave: { type: String, default: '' },
        concepto: { type: String, default: '' },
        cantidad: { type: Number, default: 0 },
    },
    { _id: true }
)

const OrdenCompraSchema: Schema = new Schema(
    {
        folio: { type: String, required: true, unique: true },
        proveedor: { type: Schema.Types.ObjectId, ref: 'Proveedor', required: true },
        proveedorSnap: { type: ProveedorFiscalSchema, default: () => ({}) },
        items: { type: [OrdenItemSchema], default: [] },
        estado: {
            type: String,
            enum: ['borrador', 'enviada', 'confirmada', 'cancelada'],
            default: 'borrador',
        },
        presupuestoEstimado: { type: Number, default: 0 },
        costoRealTotal: { type: Number, default: 0 },
        faltantes: { type: [FaltanteSchema], default: [] },
        correoEnviado: { type: Boolean, default: false },
        ordenOrigen: { type: Schema.Types.ObjectId, ref: 'OrdenCompra' },
        cotizacion: { type: Schema.Types.ObjectId, ref: 'Cotizacion' },
        folioCotizacion: { type: String, default: '' },
        notas: { type: String, default: '' },
        enviadaAt: { type: Date },
        confirmadaAt: { type: Date },
    },
    { timestamps: true }
)

const OrdenCompra = mongoose.model<IOrdenCompra>('OrdenCompra', OrdenCompraSchema)
export default OrdenCompra

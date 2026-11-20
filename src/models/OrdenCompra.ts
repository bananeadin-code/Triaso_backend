import mongoose, { Document, Schema, Types } from 'mongoose'

export type EstadoOrden = 'borrador' | 'enviada' | 'confirmada' | 'cancelada'

// Renglón de material dentro de la orden
export interface IOrdenItem {
    _id?: Types.ObjectId
    material?: Types.ObjectId
    clave: string // snapshot
    concepto: string // snapshot
    cantidad: number
    // Moneda en la que se COMPRA este material en esta orden ('mxn' o 'usd').
    // Un material con ambos precios se manda a comprar en una sola; el costeo usa esa.
    moneda: 'mxn' | 'usd'
    costoUnitario: number // MXN
    importe: number // cantidad * costoUnitario (MXN)
    costoUnitarioUSD: number // USD — independiente del MXN (no se convierte por paridad)
    importeUSD: number // cantidad * costoUnitarioUSD
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
    creadoPor: string // quién creó la orden (snapshot del nombre)
    enviadaPor: string // quién la marcó como enviada
    confirmadaPor: string // quién confirmó la recepción
    personalizados: Record<string, unknown> // campos personalizados (informativos, ver Configuración)
}

const OrdenItemSchema = new Schema<IOrdenItem>(
    {
        material: { type: Schema.Types.ObjectId, ref: 'Material' },
        clave: { type: String, default: '' },
        concepto: { type: String, required: true },
        cantidad: { type: Number, required: true, min: 0 },
        moneda: { type: String, enum: ['mxn', 'usd'], default: 'mxn' },
        costoUnitario: { type: Number, default: 0, min: 0 },
        importe: { type: Number, default: 0 },
        costoUnitarioUSD: { type: Number, default: 0, min: 0 },
        importeUSD: { type: Number, default: 0 },
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
        creadoPor: { type: String, default: '' },
        enviadaPor: { type: String, default: '' },
        confirmadaPor: { type: String, default: '' },
        personalizados: { type: Schema.Types.Mixed, default: {} },
    },
    { timestamps: true }
)

// Índices: órdenes de una cotización, de un proveedor y listados por estado/fecha
OrdenCompraSchema.index({ cotizacion: 1 })
OrdenCompraSchema.index({ proveedor: 1 })
OrdenCompraSchema.index({ estado: 1, createdAt: -1 })
OrdenCompraSchema.index({ createdAt: -1 })

const OrdenCompra = mongoose.model<IOrdenCompra>('OrdenCompra', OrdenCompraSchema)
export default OrdenCompra

import mongoose, { Document, Schema, Types } from 'mongoose'

// Material dentro de una línea de la cotización (snapshot del BOM al cotizar)
export interface ICotMaterial {
    material?: Types.ObjectId
    clave: string
    concepto: string
    tipo: string
    cantidad: number // cantidad efectiva requerida (× cantidad de la línea)
    unidad: string
    costoMXN: number
    costoUSD: number
    importeMXN: number
    importeUSD: number
}

export interface ICotLinea {
    componente?: Types.ObjectId
    componenteConcepto: string
    variacion?: Types.ObjectId
    variacionNombre: string
    cantidad: number
    materiales: ICotMaterial[]
}

export interface ICotizacion extends Document {
    folio: string
    equipo?: Types.ObjectId
    equipoNombre: string
    contexto: 'creacion' | 'reparacion'
    lineas: ICotLinea[]
    costoCotizacion: number // costo real AJUSTADO manualmente (MXN), solo si costoManualDefinido
    costoManualDefinido: boolean // true si el usuario fijó el costo real a mano (gana sobre el calculado)
    estado: 'activa' | 'cancelada' | 'surtida'
}

const CotMaterialSchema = new Schema<ICotMaterial>(
    {
        material: { type: Schema.Types.ObjectId, ref: 'Material' },
        clave: { type: String, default: '' },
        concepto: { type: String, default: '' },
        tipo: { type: String, default: 'A' },
        cantidad: { type: Number, default: 0 },
        unidad: { type: String, default: 'Pieza' },
        costoMXN: { type: Number, default: 0 },
        costoUSD: { type: Number, default: 0 },
        importeMXN: { type: Number, default: 0 },
        importeUSD: { type: Number, default: 0 },
    },
    { _id: false }
)

const CotLineaSchema = new Schema<ICotLinea>(
    {
        componente: { type: Schema.Types.ObjectId, ref: 'Componente' },
        componenteConcepto: { type: String, default: '' },
        variacion: { type: Schema.Types.ObjectId },
        variacionNombre: { type: String, default: '' },
        cantidad: { type: Number, default: 1 },
        materiales: { type: [CotMaterialSchema], default: [] },
    },
    { _id: false }
)

const CotizacionSchema: Schema = new Schema(
    {
        folio: { type: String, required: true, unique: true },
        equipo: { type: Schema.Types.ObjectId, ref: 'Equipo' },
        equipoNombre: { type: String, default: '' },
        contexto: { type: String, enum: ['creacion', 'reparacion'], default: 'creacion' },
        lineas: { type: [CotLineaSchema], default: [] },
        costoCotizacion: { type: Number, default: 0 },
        costoManualDefinido: { type: Boolean, default: false },
        estado: { type: String, enum: ['activa', 'cancelada', 'surtida'], default: 'activa' },
    },
    { timestamps: true }
)

const Cotizacion = mongoose.model<ICotizacion>('Cotizacion', CotizacionSchema)
export default Cotizacion

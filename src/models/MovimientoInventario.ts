import mongoose, { Document, Schema, Types } from 'mongoose'

// Kárdex: registro AUDITABLE de cada movimiento de stock (entrada, salida o ajuste).
// A diferencia del Historial (que audita cambios a las DEFINICIONES: BOM, costos, catálogo),
// esto audita el STOCK FÍSICO: de dónde entró y a dónde salió cada pieza. Es el rastro
// contra las "pérdidas silenciosas" de material.
export interface IMovimientoInventario extends Document {
    material?: Types.ObjectId
    clave: string // snapshot
    concepto: string // snapshot
    tipo: 'entrada' | 'salida' | 'ajuste'
    cantidad: number // magnitud del movimiento (siempre positiva)
    saldoAnterior: number // stock antes del movimiento
    saldoNuevo: number // stock después del movimiento
    documento: string // origen: folio de orden/cotización o "Ajuste manual"
    motivo: string // descripción legible
    usuario: string // quién lo provocó (snapshot del nombre)
}

const MovimientoInventarioSchema: Schema = new Schema(
    {
        material: { type: Schema.Types.ObjectId, ref: 'Material' },
        clave: { type: String, default: '' },
        concepto: { type: String, default: '' },
        tipo: { type: String, enum: ['entrada', 'salida', 'ajuste'], required: true },
        cantidad: { type: Number, required: true },
        saldoAnterior: { type: Number, default: 0 },
        saldoNuevo: { type: Number, default: 0 },
        documento: { type: String, default: '' },
        motivo: { type: String, default: '' },
        usuario: { type: String, default: 'Sistema' },
    },
    { timestamps: true }
)

// Índices: el kárdex se filtra por material y/o tipo, ordenado por fecha
MovimientoInventarioSchema.index({ material: 1, createdAt: -1 })
MovimientoInventarioSchema.index({ tipo: 1, createdAt: -1 })
MovimientoInventarioSchema.index({ createdAt: -1 })

const MovimientoInventario = mongoose.model<IMovimientoInventario>('MovimientoInventario', MovimientoInventarioSchema)
export default MovimientoInventario

import mongoose, { Document, Schema, Types } from 'mongoose'
import { CATEGORIA_IDS } from '../config/categorias'

// Snapshot del proveedor al momento de asignar (no se rompe si cambia el catálogo)
export interface IProveedorSnap {
    proveedor?: Types.ObjectId
    codigo: string
    razonSocial: string
}

// Material asignado a una variación de un componente
export interface IMaterialAsignado {
    _id?: Types.ObjectId
    material?: Types.ObjectId // referencia al catálogo maestro
    clave: string // snapshot
    concepto: string // snapshot
    proveedor: IProveedorSnap // snapshot editable
    tipo: string // letra A-E para el resumen (principal o reclasificada)
    cantidad: number
    unidad: string
    costoMXN: number
    costoUSD: number
    paridad: number
    importeMXN: number // calculado: cantidad * costoMXN
    importeUSD: number // calculado: cantidad * costoUSD
}

// Variación de un componente (medida/especificación) con su propia lista de materiales
export interface IVariacion {
    _id?: Types.ObjectId
    nombre: string
    materiales: IMaterialAsignado[]
}

export interface IComponente extends Document {
    concepto: string
    descripcion: string
    variaciones: IVariacion[]
    activo: boolean
}

const ProveedorSnapSchema = new Schema<IProveedorSnap>(
    {
        proveedor: { type: Schema.Types.ObjectId, ref: 'Proveedor' },
        codigo: { type: String, default: '' },
        razonSocial: { type: String, default: '' },
    },
    { _id: false }
)

const MaterialAsignadoSchema = new Schema<IMaterialAsignado>(
    {
        material: { type: Schema.Types.ObjectId, ref: 'Material' },
        clave: { type: String, default: '' },
        concepto: { type: String, required: true },
        proveedor: { type: ProveedorSnapSchema, default: () => ({}) },
        tipo: { type: String, enum: CATEGORIA_IDS, required: true },
        cantidad: { type: Number, required: true, min: 0 },
        unidad: { type: String, default: 'Pieza' },
        costoMXN: { type: Number, default: 0, min: 0 },
        costoUSD: { type: Number, default: 0, min: 0 },
        paridad: { type: Number, default: 0, min: 0 },
        importeMXN: { type: Number, default: 0 },
        importeUSD: { type: Number, default: 0 },
    },
    { _id: true }
)

const VariacionSchema = new Schema<IVariacion>(
    {
        nombre: { type: String, required: true, default: 'Estándar' },
        materiales: { type: [MaterialAsignadoSchema], default: [] },
    },
    { _id: true }
)

const ComponenteSchema: Schema = new Schema(
    {
        concepto: { type: String, required: true, trim: true },
        descripcion: { type: String, default: '', trim: true },
        variaciones: { type: [VariacionSchema], default: [] },
        activo: { type: Boolean, default: true },
    },
    { timestamps: true }
)

const Componente = mongoose.model<IComponente>('Componente', ComponenteSchema)
export default Componente

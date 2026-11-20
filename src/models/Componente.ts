import mongoose, { Document, Schema, Types } from 'mongoose'

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
    porValidar: boolean // creado por una importación, pendiente de revisión
    lote?: Types.ObjectId // lote de importación que lo creó
    personalizados: Record<string, unknown> // campos personalizados (informativos, ver Configuración)
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
        tipo: { type: String, required: true }, // id de categoría; validado contra las configuradas
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
        // Alta hecha por una importación y aún no revisada por una persona (se marca en el catálogo)
        porValidar: { type: Boolean, default: false },
        lote: { type: Schema.Types.ObjectId, ref: 'ImportacionLote' },
        personalizados: { type: Schema.Types.Mixed, default: {} },
    },
    { timestamps: true }
)

// Índice: qué componentes usan un material (propagación de costos, guarda de borrado)
ComponenteSchema.index({ 'variaciones.materiales.material': 1 })

const Componente = mongoose.model<IComponente>('Componente', ComponenteSchema)
export default Componente

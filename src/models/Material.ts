import mongoose, { Document, Schema, Types } from 'mongoose'

export interface IMaterial extends Document {
    clave: string // autogenerada, ej. EL0001
    concepto: string // nombre del material
    categoriaPrincipal: string // id A-E (única); define el prefijo de la clave
    proveedorPrincipal: Types.ObjectId
    proveedoresAsociados: Types.ObjectId[]
    // En qué moneda(s) se COMPRA este material (lo declara Triaso al capturarlo).
    // 'mxn' = solo pesos · 'usd' = solo dólares (se importa de E.U.) · 'ambos' = los dos.
    // La moneda no aplicable queda en 0 y se muestra vacía en catálogo/BOM/reportes.
    moneda: 'mxn' | 'usd' | 'ambos'
    // Cuando tiene AMBOS precios, cuál se usa para COSTEAR (BOM/cotización). El otro es
    // dato secundario para compras. Con 'mxn'/'usd' coincide con `moneda`.
    monedaPrincipal: 'mxn' | 'usd'
    // Costos unitarios (mismos campos que el material asignado a un componente, para sincronizar).
    // Ambos son OPCIONALES: si el material no se compra en esa moneda, va en 0 (vacío).
    costoUnitario: number // costo unitario en MXN
    costoUSD: number // costo unitario en USD
    importeMXN: number // importe unitario MXN (= costoUnitario)
    importeUSD: number // importe unitario USD (= costoUSD)
    // Campos personalizados (INFORMATIVOS): valores extra que define la empresa en Configuración.
    // Solo se muestran; ninguna lógica del sistema los usa.
    porValidar: boolean // creado por una importación, pendiente de revisión
    lote?: Types.ObjectId // lote de importación que lo creó
    personalizados: Record<string, unknown>
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
            // El id de categoría lo valida el controlador contra las categorías configuradas
            // (la empresa puede editarlas/agregarlas/quitarlas), por eso no es un enum fijo.
            type: String,
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
        moneda: {
            type: String,
            enum: ['mxn', 'usd', 'ambos'],
            default: 'mxn',
        },
        monedaPrincipal: {
            type: String,
            enum: ['mxn', 'usd'],
            default: 'mxn',
        },
        costoUnitario: {
            type: Number,
            default: 0, // opcional: 0 = no se compra en pesos
            min: 0,
        },
        costoUSD: { type: Number, default: 0, min: 0 },
        importeMXN: { type: Number, default: 0 },
        importeUSD: { type: Number, default: 0 },
        // Alta hecha por una importación y aún no revisada por una persona (se marca en el catálogo)
        porValidar: { type: Boolean, default: false },
        lote: { type: Schema.Types.ObjectId, ref: 'ImportacionLote' },
        personalizados: { type: Schema.Types.Mixed, default: {} },
        activo: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
)

// Índices: materiales de un proveedor (detalle del proveedor, guarda de borrado)
MaterialSchema.index({ proveedorPrincipal: 1 })
MaterialSchema.index({ proveedoresAsociados: 1 })

const Material = mongoose.model<IMaterial>('Material', MaterialSchema)
export default Material

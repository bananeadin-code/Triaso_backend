import mongoose, { Document, Schema, Types } from 'mongoose'

// Registro de un cambio relevante del sistema (BOM, equipos y costos del catálogo).
export interface IHistorial extends Document {
    usuario: string // nombre del responsable (snapshot)
    tipo: 'componente' | 'equipo' | 'material' // qué se modificó
    componente?: Types.ObjectId
    componenteConcepto: string
    equipo?: Types.ObjectId
    equipoNombre: string
    material?: Types.ObjectId
    materialClave: string
    materialConcepto: string
    equiposAfectados: { equipo?: Types.ObjectId; nombre: string }[]
    cambios: string[] // lista de cambios "detalle: antes → ahora"
    sensible: boolean // cambio fuerte (agregó/eliminó variación o componente, costo global, etc.)
    critico: boolean // cambio irreversible (eliminación de un equipo)
}

const HistorialSchema: Schema = new Schema(
    {
        usuario: { type: String, default: 'Sistema' },
        tipo: { type: String, enum: ['componente', 'equipo', 'material'], default: 'componente' },
        componente: { type: Schema.Types.ObjectId, ref: 'Componente' },
        componenteConcepto: { type: String, default: '' },
        equipo: { type: Schema.Types.ObjectId, ref: 'Equipo' },
        equipoNombre: { type: String, default: '' },
        material: { type: Schema.Types.ObjectId, ref: 'Material' },
        materialClave: { type: String, default: '' },
        materialConcepto: { type: String, default: '' },
        equiposAfectados: [
            {
                _id: false,
                equipo: { type: Schema.Types.ObjectId, ref: 'Equipo' },
                nombre: { type: String, default: '' },
            },
        ],
        cambios: { type: [String], default: [] },
        sensible: { type: Boolean, default: false },
        critico: { type: Boolean, default: false },
    },
    { timestamps: true }
)

const Historial = mongoose.model<IHistorial>('Historial', HistorialSchema)
export default Historial

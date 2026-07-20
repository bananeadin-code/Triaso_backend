import mongoose, { Document, Schema, Types } from 'mongoose'

// Una línea del BOM: qué componente + qué variación usa el equipo y en qué cantidad.
export interface ILineaBOM {
    _id?: Types.ObjectId
    componente: Types.ObjectId
    variacion: Types.ObjectId // _id de la variación dentro del componente
    cantidad: number // cuántas veces se usa ese componente/variación en el equipo
}

export interface IEquipo extends Document {
    nombre: string
    tipo: string // ej. Trituradora, Manufactura
    descripcion: string
    lineas: ILineaBOM[]
    activo: boolean
}

const LineaBOMSchema = new Schema<ILineaBOM>(
    {
        componente: { type: Schema.Types.ObjectId, ref: 'Componente', required: true },
        variacion: { type: Schema.Types.ObjectId, required: true },
        cantidad: { type: Number, default: 1, min: 1 },
    },
    { _id: true }
)

const EquipoSchema: Schema = new Schema(
    {
        nombre: { type: String, required: true, trim: true },
        tipo: { type: String, default: '', trim: true },
        descripcion: { type: String, default: '', trim: true },
        lineas: { type: [LineaBOMSchema], default: [] },
        activo: { type: Boolean, default: true },
    },
    { timestamps: true }
)

const Equipo = mongoose.model<IEquipo>('Equipo', EquipoSchema)
export default Equipo

import mongoose, { Document, Schema } from 'mongoose'

// Bitácora de la gestión de usuarios (solo la ve el admin). Separada del Historial del BOM
// para no desplazar sus registros ni exponer esta información al Operador general.
export type AccionBitacora = 'alta' | 'baja' | 'cambio' | 'password'

export interface IBitacoraUsuario extends Document {
    actor: string // nombre (correo) de quien hizo el cambio — snapshot
    accion: AccionBitacora
    afectado: string // nombre (correo) del usuario afectado — snapshot
    detalle: string[]
}

const BitacoraUsuarioSchema: Schema = new Schema(
    {
        actor: { type: String, required: true },
        accion: { type: String, enum: ['alta', 'baja', 'cambio', 'password'], required: true },
        afectado: { type: String, required: true },
        detalle: { type: [String], default: [] },
    },
    { timestamps: true }
)

const BitacoraUsuario = mongoose.model<IBitacoraUsuario>('BitacoraUsuario', BitacoraUsuarioSchema)
export default BitacoraUsuario

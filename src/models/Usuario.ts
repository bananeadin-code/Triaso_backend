import mongoose, { Document, Schema } from 'mongoose'
import { ROLES, Rol } from '../config/permisos'

export { ROLES }
export type { Rol }

export interface IPermisos {
    limpiarHistoriales: boolean
    generarReportes: boolean
}

export interface IUsuario extends Document {
    nombre: string
    email: string
    password: string
    rol: Rol
    permisos: IPermisos
    activo: boolean
}

const PermisosSchema = new Schema<IPermisos>(
    {
        limpiarHistoriales: { type: Boolean, default: false },
        generarReportes: { type: Boolean, default: false },
    },
    { _id: false }
)

const UsuarioSchema: Schema = new Schema(
    {
        nombre: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
        },
        rol: {
            type: String,
            enum: ROLES,
            default: 'capturista',
            required: true,
        },
        // Permisos transversales (dentro de sus módulos de acceso). admin/operador siempre los tienen.
        permisos: { type: PermisosSchema, default: () => ({ limpiarHistoriales: false, generarReportes: false }) },
        activo: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
)

const Usuario = mongoose.model<IUsuario>('Usuario', UsuarioSchema)
export default Usuario

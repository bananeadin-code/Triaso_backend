import mongoose, { Document, Schema } from 'mongoose'
import { ROLES, Rol, AccesoModulo } from '../config/permisos'

export { ROLES }
export type { Rol }

export interface IPermisos {
    generarReportes: boolean
}

export interface IUsuario extends Document {
    nombre: string
    email: string
    password: string
    rol: Rol
    permisos: IPermisos
    // Si es true, `accesos` reemplaza al paquete del rol (módulo por módulo, CRUD por operación)
    accesosPersonalizados: boolean
    accesos?: Map<string, AccesoModulo>
    activo: boolean
    sesionVersion: number
    debeCambiarPassword: boolean
}

const PermisosSchema = new Schema<IPermisos>(
    {
        generarReportes: { type: Boolean, default: false },
    },
    { _id: false }
)

const AccesoSchema = new Schema<AccesoModulo>(
    {
        menu: { type: Boolean, default: false },
        ver: { type: Boolean, default: false },
        crear: { type: Boolean, default: false },
        editar: { type: Boolean, default: false },
        eliminar: { type: Boolean, default: false },
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
        permisos: { type: PermisosSchema, default: () => ({ generarReportes: false }) },
        accesosPersonalizados: { type: Boolean, default: false },
        accesos: { type: Map, of: AccesoSchema, default: undefined },
        activo: {
            type: Boolean,
            default: true,
        },
        // Se incrementa al cambiar contraseña o desactivar: invalida los tokens emitidos antes
        sesionVersion: { type: Number, default: 0 },
        // Contraseña asignada por otra persona (alta, restablecimiento, recuperación): debe cambiarla al entrar
        debeCambiarPassword: { type: Boolean, default: false },
    },
    { timestamps: true }
)

const Usuario = mongoose.model<IUsuario>('Usuario', UsuarioSchema)
export default Usuario

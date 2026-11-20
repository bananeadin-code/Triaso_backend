import type { Request, Response } from 'express'
import Usuario from '../models/Usuario'
import { hashPassword } from '../helpers'
import { ROLES, ROL_DEFS, Rol } from '../config/permisos'
import BitacoraUsuario from '../models/BitacoraUsuario'
import { registrarBitacora } from '../services/bitacoraUsuarios'

function permisosDesde(body: unknown): { limpiarHistoriales: boolean; generarReportes: boolean } {
    const p = (body ?? {}) as { limpiarHistoriales?: unknown; generarReportes?: unknown }
    return {
        limpiarHistoriales: !!p.limpiarHistoriales,
        generarReportes: !!p.generarReportes,
    }
}

// Solo cuenta como "control del sistema" un admin ACTIVO: un admin desactivado no puede entrar.
const adminsActivos = () => Usuario.countDocuments({ rol: 'admin', activo: true })

const nombreRol = (r: string) => ROL_DEFS[r as Rol]?.nombre ?? r
const sino = (b: boolean) => (b ? 'sí' : 'no')
const PERMISO_LABEL = { limpiarHistoriales: 'Limpiar historiales', generarReportes: 'Generar reportes PDF' } as const

export class UsuarioController {
    // Lista de usuarios (sin contraseña) + catálogo de roles con su descripción
    static listar = async (req: Request, res: Response) => {
        try {
            const usuarios = await Usuario.find().select('nombre email rol permisos activo createdAt').sort({ createdAt: 1 })
            const roles = ROLES.map((r) => ({
                clave: r,
                nombre: ROL_DEFS[r].nombre,
                descripcion: ROL_DEFS[r].descripcion,
                nav: ROL_DEFS[r].nav,
            }))
            res.json({ usuarios, roles })
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener los usuarios' })
        }
    }

    static crear = async (req: Request, res: Response) => {
        try {
            const { nombre, email, password, rol } = req.body
            if (!ROLES.includes(rol as Rol)) {
                return res.status(400).json({ error: 'Rol no válido' })
            }

            const existe = await Usuario.findOne({ email: String(email).toLowerCase().trim() })
            if (existe) {
                return res.status(409).json({ error: 'Ya existe un usuario con ese correo' })
            }

            const usuario = new Usuario({
                nombre: String(nombre).trim(),
                email,
                password: await hashPassword(password),
                rol,
                permisos: permisosDesde(req.body.permisos),
                // Por defecto la contraseña inicial es temporal: la conoce quien dio el alta
                debeCambiarPassword: req.body.debeCambiarPassword !== false,
            })
            await usuario.save()
            await registrarBitacora(req.usuario!, 'alta', usuario, [`Rol: ${nombreRol(usuario.rol)}`])
            res.status(201).json({ mensaje: 'Usuario creado correctamente', id: usuario.id })
        } catch (error) {
            res.status(500).json({ error: 'Error al crear el usuario' })
        }
    }

    // El admin solo puede cambiar rol, permisos y activar/desactivar (NO nombre/correo/contraseña)
    static actualizar = async (req: Request, res: Response) => {
        try {
            const usuario = await Usuario.findById(req.params.id)
            if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' })

            const esUnoMismo = String(usuario.id) === String(req.usuario!.id)
            const antes = { rol: usuario.rol, permisos: { ...usuario.toObject().permisos }, activo: usuario.activo }

            if (req.body.rol !== undefined && req.body.rol !== usuario.rol) {
                if (!ROLES.includes(req.body.rol as Rol)) return res.status(400).json({ error: 'Rol no válido' })
                // No puedes quitarte a ti mismo el rol de admin: el sistema se quedaría sin quien gestione usuarios
                if (esUnoMismo) return res.status(409).json({ error: 'No puedes cambiar tu propio rol' })
                usuario.rol = req.body.rol
            }
            if (req.body.permisos !== undefined) {
                usuario.permisos = permisosDesde(req.body.permisos) as never
            }
            if (req.body.activo !== undefined) {
                if (typeof req.body.activo !== 'boolean') return res.status(400).json({ error: 'Estado no válido' })
                if (esUnoMismo && req.body.activo === false) {
                    return res.status(409).json({ error: 'No puedes desactivar tu propia cuenta' })
                }
                usuario.activo = req.body.activo
            }

            // ¿Este cambio le quita a un admin activo su capacidad de administrar?
            const eraAdminActivo = antes.rol === 'admin' && antes.activo
            const quedaAdminActivo = usuario.rol === 'admin' && usuario.activo
            const pierdeControl = eraAdminActivo && !quedaAdminActivo
            if (pierdeControl && (await adminsActivos()) <= 1) {
                return res.status(409).json({ error: 'Debe quedar al menos un administrador activo' })
            }

            // Al desactivar, se cierran sus sesiones abiertas
            if (antes.activo && !usuario.activo) usuario.sesionVersion = (usuario.sesionVersion ?? 0) + 1

            await usuario.save()

            // Doble verificación contra cambios simultáneos (dos admins degradándose entre sí a la vez)
            if (pierdeControl && (await adminsActivos()) === 0) {
                usuario.rol = antes.rol
                usuario.activo = antes.activo
                usuario.permisos = antes.permisos as never
                await usuario.save()
                return res.status(409).json({ error: 'Debe quedar al menos un administrador activo' })
            }

            const detalle: string[] = []
            if (antes.rol !== usuario.rol) detalle.push(`Rol: ${nombreRol(antes.rol)} → ${nombreRol(usuario.rol)}`)
            if (antes.activo !== usuario.activo) detalle.push(`Activo: ${sino(antes.activo)} → ${sino(usuario.activo)}`)
            for (const k of Object.keys(PERMISO_LABEL) as (keyof typeof PERMISO_LABEL)[]) {
                const a = !!antes.permisos?.[k]
                const d = !!usuario.permisos?.[k]
                if (a !== d) detalle.push(`${PERMISO_LABEL[k]}: ${sino(a)} → ${sino(d)}`)
            }
            if (detalle.length > 0) await registrarBitacora(req.usuario!, 'cambio', usuario, detalle)

            res.json({ mensaje: 'Usuario actualizado' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el usuario' })
        }
    }

    static eliminar = async (req: Request, res: Response) => {
        try {
            if (String(req.params.id) === String(req.usuario!.id)) {
                return res.status(409).json({ error: 'No puedes eliminar tu propia cuenta' })
            }
            const usuario = await Usuario.findById(req.params.id)
            if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' })

            const eraAdminActivo = usuario.rol === 'admin' && usuario.activo
            if (eraAdminActivo && (await adminsActivos()) <= 1) {
                return res.status(409).json({ error: 'Debe quedar al menos un administrador activo' })
            }

            const respaldo = usuario.toObject()
            await usuario.deleteOne()

            // Doble verificación contra eliminaciones simultáneas: si ya no queda ningún admin activo, se restaura
            if (eraAdminActivo && (await adminsActivos()) === 0) {
                await Usuario.collection.insertOne(respaldo)
                return res.status(409).json({ error: 'Debe quedar al menos un administrador activo' })
            }

            await registrarBitacora(req.usuario!, 'baja', usuario, [`Rol: ${nombreRol(usuario.rol)}`])
            res.json({ mensaje: 'Usuario eliminado' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el usuario' })
        }
    }

    // El admin asigna una contraseña temporal a OTRO usuario (olvido de contraseña).
    // Cierra sus sesiones abiertas y le exige cambiarla al entrar.
    static restablecerPassword = async (req: Request, res: Response) => {
        try {
            if (String(req.params.id) === String(req.usuario!.id)) {
                return res.status(409).json({ error: 'Para tu propia cuenta usa "Mi perfil"' })
            }
            const usuario = await Usuario.findById(req.params.id)
            if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' })

            usuario.password = await hashPassword(req.body.password)
            usuario.sesionVersion = (usuario.sesionVersion ?? 0) + 1
            usuario.debeCambiarPassword = true
            await usuario.save()
            await registrarBitacora(req.usuario!, 'password', usuario, ['Contraseña restablecida (temporal)'])
            res.json({ mensaje: 'Contraseña restablecida. Deberá cambiarla al iniciar sesión.' })
        } catch (error) {
            res.status(500).json({ error: 'Error al restablecer la contraseña' })
        }
    }

    static bitacora = async (req: Request, res: Response) => {
        try {
            const registros = await BitacoraUsuario.find().sort({ createdAt: -1 }).limit(200)
            res.json(registros)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener la bitácora' })
        }
    }
}

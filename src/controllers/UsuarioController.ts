import type { Request, Response } from 'express'
import Usuario from '../models/Usuario'
import { hashPassword } from '../helpers'
import { ROLES, ROL_DEFS, Rol } from '../config/permisos'

function permisosDesde(body: unknown): { limpiarHistoriales: boolean; generarReportes: boolean } {
    const p = (body ?? {}) as { limpiarHistoriales?: unknown; generarReportes?: unknown }
    return {
        limpiarHistoriales: !!p.limpiarHistoriales,
        generarReportes: !!p.generarReportes,
    }
}

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
                nombre,
                email,
                password: await hashPassword(password),
                rol,
                permisos: permisosDesde(req.body.permisos),
            })
            await usuario.save()
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

            if (req.body.rol !== undefined && req.body.rol !== usuario.rol) {
                if (!ROLES.includes(req.body.rol as Rol)) return res.status(400).json({ error: 'Rol no válido' })
                // No puedes quitarte a ti mismo el rol de admin: el sistema se quedaría sin quien gestione usuarios
                if (esUnoMismo) {
                    return res.status(409).json({ error: 'No puedes cambiar tu propio rol' })
                }
                // Tampoco se puede degradar al último administrador que queda
                if (usuario.rol === 'admin') {
                    const admins = await Usuario.countDocuments({ rol: 'admin' })
                    if (admins <= 1) return res.status(409).json({ error: 'No puedes quitar el rol al único administrador' })
                }
                usuario.rol = req.body.rol
            }
            if (req.body.permisos !== undefined) {
                usuario.permisos = permisosDesde(req.body.permisos) as never
            }
            if (req.body.activo !== undefined) {
                // No permitir que el admin se desactive a sí mismo
                if (esUnoMismo && req.body.activo === false) {
                    return res.status(409).json({ error: 'No puedes desactivar tu propia cuenta' })
                }
                usuario.activo = !!req.body.activo
            }

            await usuario.save()
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

            // No dejar el sistema sin ningún administrador
            if (usuario.rol === 'admin') {
                const admins = await Usuario.countDocuments({ rol: 'admin' })
                if (admins <= 1) return res.status(409).json({ error: 'No puedes eliminar al único administrador' })
            }

            await usuario.deleteOne()
            res.json({ mensaje: 'Usuario eliminado' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el usuario' })
        }
    }
}

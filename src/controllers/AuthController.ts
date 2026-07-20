import type { Request, Response } from 'express'
import Usuario from '../models/Usuario'
import { checkPassword, generateJWT, hashPassword } from '../helpers'
import { resolverAccesos } from '../config/permisos'

export class AuthController {
    // Login
    static login = async (req: Request, res: Response) => {
        try {
            const { email, password } = req.body

            const usuario = await Usuario.findOne({ email })
            if (!usuario) {
                return res.status(404).json({ error: 'Usuario no encontrado' })
            }
            if (!usuario.activo) {
                return res.status(403).json({ error: 'Usuario desactivado' })
            }

            const passwordCorrecto = await checkPassword(password, usuario.password)
            if (!passwordCorrecto) {
                return res.status(401).json({ error: 'Contraseña incorrecta' })
            }

            const token = generateJWT({ id: usuario.id })
            res.json({ token })
        } catch (error) {
            res.status(500).json({ error: 'Ocurrió un error al iniciar sesión' })
        }
    }

    // Datos del usuario autenticado + sus accesos (nav, nivel por módulo, permisos efectivos)
    static perfil = async (req: Request, res: Response) => {
        const u = req.usuario!
        const accesos = resolverAccesos(u)
        res.json({
            _id: u.id,
            nombre: u.nombre,
            email: u.email,
            rol: u.rol,
            activo: u.activo,
            nombreRol: accesos.nombreRol,
            panel: accesos.panel,
            nav: accesos.nav,
            acceso: accesos.acceso,
            permisos: accesos.permisos,
        })
    }

    // El propio usuario cambia su nombre. El correo SOLO lo puede cambiar el admin (sobre sí mismo).
    static actualizarPerfil = async (req: Request, res: Response) => {
        try {
            const { nombre, email } = req.body
            if (!nombre || !String(nombre).trim()) {
                return res.status(400).json({ error: 'El nombre es obligatorio' })
            }
            const usuario = await Usuario.findById(req.usuario!.id)
            if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' })

            usuario.nombre = String(nombre).trim()

            if (email !== undefined) {
                const limpio = String(email).toLowerCase().trim()
                if (limpio !== usuario.email) {
                    if (usuario.rol !== 'admin') {
                        return res.status(403).json({ error: 'Solo el administrador puede cambiar su propio correo' })
                    }
                    if (!/^\S+@\S+\.\S+$/.test(limpio)) {
                        return res.status(400).json({ error: 'Correo no válido' })
                    }
                    const ocupado = await Usuario.findOne({ email: limpio, _id: { $ne: usuario._id } })
                    if (ocupado) {
                        return res.status(409).json({ error: 'Ya existe un usuario con ese correo' })
                    }
                    usuario.email = limpio
                }
            }

            await usuario.save()
            res.json({ mensaje: 'Perfil actualizado' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el perfil' })
        }
    }

    // El propio usuario cambia su contraseña (verifica la actual)
    static cambiarPassword = async (req: Request, res: Response) => {
        try {
            const { actual, nueva } = req.body
            if (!actual || !nueva) {
                return res.status(400).json({ error: 'Debes indicar la contraseña actual y la nueva' })
            }
            if (String(nueva).length < 6) {
                return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' })
            }
            const usuario = await Usuario.findById(req.usuario!.id)
            if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' })

            const ok = await checkPassword(actual, usuario.password)
            if (!ok) return res.status(401).json({ error: 'La contraseña actual no es correcta' })

            usuario.password = await hashPassword(nueva)
            await usuario.save()
            res.json({ mensaje: 'Contraseña actualizada' })
        } catch (error) {
            res.status(500).json({ error: 'Error al cambiar la contraseña' })
        }
    }
}

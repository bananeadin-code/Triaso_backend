import type { Request, Response } from 'express'
import Usuario from '../models/Usuario'
import { checkPassword, compararSinFiltrar, generateJWT, hashPassword } from '../helpers'
import { limpiarFallos, registrarFallo, segundosDeBloqueo } from '../services/limitadorLogin'
import { resolverAccesos } from '../config/permisos'

export class AuthController {
    // Login
    static login = async (req: Request, res: Response) => {
        try {
            const email = String(req.body.email).toLowerCase().trim()
            const password = String(req.body.password)
            const ip = req.ip ?? 'desconocida'

            // Demasiados intentos fallidos → esperar (no se revisa la contraseña)
            const espera = segundosDeBloqueo(email, ip)
            if (espera > 0) {
                res.setHeader('Retry-After', String(espera))
                return res.status(429).json({
                    error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(espera / 60)} minuto(s).`,
                })
            }

            // Mismo mensaje y mismo tiempo de respuesta exista o no el correo:
            // así no se puede averiguar qué correos están registrados.
            const usuario = await Usuario.findOne({ email })
            const passwordCorrecto = await compararSinFiltrar(password, usuario?.password)
            if (!usuario || !passwordCorrecto) {
                registrarFallo(email, ip)
                return res.status(401).json({ error: 'Correo o contraseña incorrectos' })
            }
            limpiarFallos(email, ip)

            // Solo quien SÍ conoce la contraseña llega a saber que la cuenta está desactivada
            if (!usuario.activo) {
                return res.status(403).json({ error: 'Usuario desactivado' })
            }

            const token = generateJWT({ id: usuario.id, v: usuario.sesionVersion ?? 0 })
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
            operaciones: accesos.operaciones,
            personalizado: accesos.personalizado,
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

            // 400 (no 401): un 401 haría que el front cerrara la sesión por un simple error de tecleo
            const ok = await checkPassword(actual, usuario.password)
            if (!ok) return res.status(400).json({ error: 'La contraseña actual no es correcta' })

            usuario.password = await hashPassword(nueva)
            // Cierra las sesiones abiertas en otros equipos; este equipo recibe un token nuevo
            usuario.sesionVersion = (usuario.sesionVersion ?? 0) + 1
            await usuario.save()
            res.json({
                mensaje: 'Contraseña actualizada. Se cerró la sesión en tus otros equipos.',
                token: generateJWT({ id: usuario.id, v: usuario.sesionVersion }),
            })
        } catch (error) {
            res.status(500).json({ error: 'Error al cambiar la contraseña' })
        }
    }
}

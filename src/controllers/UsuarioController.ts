import type { Request, Response } from 'express'
import Usuario from '../models/Usuario'
import { hashPassword } from '../helpers'
import { MODULOS, ROLES, ROL_DEFS, Rol, MatrizAccesos, matrizDeRol, matrizEfectiva, normalizarMatriz } from '../config/permisos'
import { registrarHistorial } from '../services/historial'

function permisosDesde(body: unknown): { generarReportes: boolean } {
    const p = (body ?? {}) as { generarReportes?: unknown }
    return { generarReportes: !!p.generarReportes }
}

const ETQ_OP: Record<string, string> = { menu: 'menú', ver: 'ver', crear: 'crear', editar: 'editar', eliminar: 'eliminar' }

// Describe en texto las diferencias entre dos matrices (para la bitácora)
function diffMatrices(antes: MatrizAccesos, despues: MatrizAccesos): string[] {
    const out: string[] = []
    for (const m of MODULOS) {
        if (m === 'usuarios') continue
        const a = antes[m]
        const d = despues[m]
        const dadas: string[] = []
        const quitadas: string[] = []
        for (const k of Object.keys(ETQ_OP) as (keyof typeof a)[]) {
            if (!a[k] && d[k]) dadas.push(ETQ_OP[k])
            if (a[k] && !d[k]) quitadas.push(ETQ_OP[k])
        }
        if (dadas.length || quitadas.length) {
            out.push(
                `${m}: ` +
                    [dadas.length ? `+ ${dadas.join(', ')}` : '', quitadas.length ? `− ${quitadas.join(', ')}` : '']
                        .filter(Boolean)
                        .join(' · ')
            )
        }
    }
    return out
}

export class UsuarioController {
    // Lista de usuarios (sin contraseña) con su matriz EFECTIVA + catálogo de roles
    // (cada rol con su matriz-plantilla, para previsualizar y "restablecer al paquete").
    static listar = async (req: Request, res: Response) => {
        try {
            const docs = await Usuario.find()
                .select('nombre email rol permisos accesosPersonalizados accesos activo createdAt')
                .sort({ createdAt: 1 })
            const usuarios = docs.map((u) => {
                const o = u.toObject() as unknown as Record<string, unknown>
                delete o.accesos
                return { ...o, operaciones: matrizEfectiva(u) }
            })
            const roles = ROLES.map((r) => ({
                clave: r,
                nombre: ROL_DEFS[r].nombre,
                descripcion: ROL_DEFS[r].descripcion,
                nav: ROL_DEFS[r].nav,
                matriz: matrizDeRol(r),
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

            // Permisos personalizados desde el alta (el admin nunca se personaliza)
            const personalizar = rol !== 'admin' && req.body.accesosPersonalizados === true
            const usuario = new Usuario({
                nombre,
                email,
                password: await hashPassword(password),
                rol,
                permisos: permisosDesde(req.body.permisos),
                accesosPersonalizados: personalizar,
                accesos: personalizar ? normalizarMatriz(req.body.accesos) : undefined,
            })
            await usuario.save()
            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'usuario',
                sector: 'sistema',
                accion: 'creo',
                entidad: `${usuario.nombre} (${ROL_DEFS[usuario.rol as Rol]?.nombre ?? usuario.rol})`,
                cambios: ['Alta de usuario'],
                sensible: true,
            })
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
            const matrizAntes = matrizEfectiva(usuario)
            const personalizadoAntes = !!usuario.accesosPersonalizados

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

            // --- Accesos personalizados (CRUD por módulo) ---
            if (usuario.rol === 'admin') {
                // El admin siempre tiene todo: nunca se personaliza
                usuario.accesosPersonalizados = false
                usuario.accesos = undefined
            } else if (req.body.accesosPersonalizados !== undefined) {
                if (req.body.accesosPersonalizados === true) {
                    usuario.accesosPersonalizados = true
                    usuario.accesos = new Map(Object.entries(normalizarMatriz(req.body.accesos))) as never
                } else {
                    // Volver al paquete del rol
                    usuario.accesosPersonalizados = false
                    usuario.accesos = undefined
                }
                usuario.markModified('accesos')
            }

            await usuario.save()

            // Bitácora: qué cambió en sus permisos
            const matrizDespues = matrizEfectiva(usuario)
            const cambios = diffMatrices(matrizAntes, matrizDespues)
            if (personalizadoAntes !== !!usuario.accesosPersonalizados) {
                cambios.unshift(usuario.accesosPersonalizados ? 'Permisos personalizados activados' : 'Regresó al paquete de su rol')
            }
            if (cambios.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'usuario',
                    sector: 'sistema',
                    accion: 'edito',
                    entidad: `Permisos de ${usuario.nombre}`,
                    cambios,
                    sensible: true,
                })
            }
            res.json({ mensaje: 'Usuario actualizado' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el usuario' })
        }
    }

    // El admin restablece la contraseña de un usuario EN CUALQUIER MOMENTO
    // (aunque el usuario ya la haya cambiado). Fija una nueva; el usuario podrá
    // cambiarla después desde Mi perfil. No expone la contraseña anterior (está hasheada).
    static resetearPassword = async (req: Request, res: Response) => {
        try {
            const { password } = req.body
            if (!password || String(password).length < 6) {
                return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
            }
            const usuario = await Usuario.findById(req.params.id)
            if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' })

            usuario.password = await hashPassword(password)
            // Cierra todas las sesiones abiertas del usuario (p. ej. cuenta comprometida o equipo perdido)
            usuario.sesionVersion = (usuario.sesionVersion ?? 0) + 1
            await usuario.save()
            res.json({ mensaje: `Contraseña de ${usuario.nombre} restablecida; se cerraron sus sesiones abiertas` })
        } catch (error) {
            res.status(500).json({ error: 'Error al restablecer la contraseña' })
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

            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'usuario',
                sector: 'sistema',
                accion: 'elimino',
                entidad: usuario.nombre,
                cambios: ['Usuario eliminado del sistema'],
                sensible: true,
            })
            await usuario.deleteOne()
            res.json({ mensaje: 'Usuario eliminado' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el usuario' })
        }
    }
}

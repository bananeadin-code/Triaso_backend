import { Request, Response, NextFunction } from 'express'
import { HydratedDocument } from 'mongoose'
import jwt from 'jsonwebtoken'
import Usuario, { IUsuario } from '../models/Usuario'
import { Modulo, Nivel, Operacion, OPERACIONES, Permiso, puedeOperacion, tienePermiso, Rol } from '../config/permisos'

declare global {
    namespace Express {
        interface Request {
            usuario?: HydratedDocument<IUsuario>
        }
    }
}

// Verifica el JWT y adjunta el usuario a la request
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const bearer = req.headers.authorization
    if (!bearer) {
        return res.status(401).json({ error: 'No autorizado' })
    }

    const [, token] = bearer.split(' ')
    if (!token) {
        return res.status(401).json({ error: 'Token no válido' })
    }

    const secret = process.env.JWT_SECRET
    if (!secret) {
        return res.status(500).json({ error: 'Configuración del servidor incompleta' })
    }

    try {
        const decoded = jwt.verify(token, secret)
        if (typeof decoded === 'object' && decoded.id) {
            const usuario = await Usuario.findById(decoded.id).select(
                '_id nombre email rol permisos accesosPersonalizados accesos activo sesionVersion'
            )
            if (!usuario) {
                return res.status(401).json({ error: 'Token no válido' })
            }
            // Token emitido antes de un cambio/restablecimiento de contraseña (o de formato viejo, sin `v`)
            if (typeof decoded.v !== 'number' || decoded.v !== (usuario.sesionVersion ?? 0)) {
                return res.status(401).json({ error: 'Sesión expirada, vuelve a iniciar sesión' })
            }
            if (!usuario.activo) {
                return res.status(403).json({ error: 'Usuario desactivado' })
            }
            req.usuario = usuario
            return next()
        }
        return res.status(401).json({ error: 'Token no válido' })
    } catch (error) {
        return res.status(401).json({ error: 'Token no válido' })
    }
}

// Operación según el método HTTP (para rutas de escritura sin operación explícita)
function opDeMetodo(metodo: string): Operacion {
    switch (metodo.toUpperCase()) {
        case 'POST':
            return 'crear'
        case 'PUT':
        case 'PATCH':
            return 'editar'
        case 'DELETE':
            return 'eliminar'
        default:
            return 'ver'
    }
}

const VERBO: Record<Operacion, string> = { ver: 'consultar', crear: 'crear en', editar: 'editar en', eliminar: 'eliminar en' }

// Exige permiso sobre el `modulo` según la matriz EFECTIVA del usuario (rol o personalizada).
//  - 'lectura'                  → operación 'ver'
//  - 'escritura' / 'total'      → la operación se deduce del método (POST crear, PUT editar, DELETE eliminar)
//  - 'ver'|'crear'|'editar'|'eliminar' → operación explícita (para acciones que no calzan con el método)
export const checkModulo = (modulo: Modulo, nivelUOp: Nivel | Operacion = 'lectura') => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.usuario) return res.status(401).json({ error: 'No autorizado' })
        const op: Operacion = (OPERACIONES as readonly string[]).includes(nivelUOp)
            ? (nivelUOp as Operacion)
            : nivelUOp === 'lectura'
              ? 'ver'
              : opDeMetodo(req.method)
        const u = req.usuario
        if (puedeOperacion({ rol: u.rol as Rol, accesosPersonalizados: u.accesosPersonalizados, accesos: u.accesos }, modulo, op))
            return next()
        return res.status(403).json({ error: `No tienes permiso para ${VERBO[op]} ${modulo}` })
    }
}

// Exige un permiso transversal (generarReportes). admin y operador siempre pasan.
export const checkPermiso = (permiso: Permiso) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.usuario) return res.status(401).json({ error: 'No autorizado' })
        if (tienePermiso(req.usuario, permiso)) return next()
        return res.status(403).json({ error: 'No tienes permiso para esta acción' })
    }
}

// Solo el administrador (gestión de usuarios)
export const soloAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.usuario?.rol === 'admin') return next()
    return res.status(403).json({ error: 'Solo el administrador puede hacer esto' })
}

// Roles de gestión (admin u operador): parámetros globales de la empresa,
// p. ej. el tipo de cambio. Ambos son roles con acceso total.
export const soloGestion = (req: Request, res: Response, next: NextFunction) => {
    if (req.usuario?.rol === 'admin' || req.usuario?.rol === 'operador') return next()
    return res.status(403).json({ error: 'Solo administración puede cambiar los parámetros del sistema' })
}

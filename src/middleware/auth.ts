import { Request, Response, NextFunction } from 'express'
import { HydratedDocument } from 'mongoose'
import jwt from 'jsonwebtoken'
import Usuario, { IUsuario } from '../models/Usuario'
import { Modulo, Nivel, Permiso, puedeModulo, tienePermiso, Rol } from '../config/permisos'

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
            const usuario = await Usuario.findById(decoded.id).select('_id nombre email rol permisos activo')
            if (!usuario) {
                return res.status(401).json({ error: 'Token no válido' })
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

// Exige al menos `nivel` de acceso al `modulo` según el rol del usuario.
export const checkModulo = (modulo: Modulo, nivel: Nivel = 'lectura') => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.usuario) return res.status(401).json({ error: 'No autorizado' })
        if (puedeModulo(req.usuario.rol as Rol, modulo, nivel)) return next()
        return res.status(403).json({ error: 'No tienes acceso a este módulo' })
    }
}

// Exige un permiso transversal (limpiarHistoriales / generarReportes). admin y operador siempre pasan.
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

import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

// --- Contraseñas ---
export const hashPassword = async (password: string) => {
    const salt = await bcrypt.genSalt(10)
    return await bcrypt.hash(password, salt)
}

export const checkPassword = async (enteredPassword: string, storedHash: string) => {
    return await bcrypt.compare(enteredPassword, storedHash)
}

// Hash de relleno: cuando el correo no existe se compara contra él igual, para que la
// respuesta tarde lo mismo y no delate por tiempo qué correos están registrados.
let hashRelleno: string | null = null
export const compararSinFiltrar = async (enteredPassword: string, storedHash?: string) => {
    if (storedHash) return checkPassword(enteredPassword, storedHash)
    hashRelleno ??= await bcrypt.hash('relleno-sin-usuario', 10)
    await bcrypt.compare(enteredPassword, hashRelleno)
    return false
}

// --- JWT ---
// `v` = versión de sesión del usuario: al cambiar o restablecer la contraseña sube y
// todos los tokens emitidos antes dejan de servir (cierra sesiones abiertas en otros equipos).
type JWTPayload = {
    id: string
    v: number // versión de sesión del usuario
}

// Vigencia de la sesión (configurable; por defecto una jornada laboral)
const VIGENCIA = (process.env.JWT_EXPIRES || '12h') as jwt.SignOptions['expiresIn']

export const generateJWT = (payload: JWTPayload) => {
    const secret = process.env.JWT_SECRET
    if (!secret) {
        throw new Error('Falta la variable de entorno JWT_SECRET')
    }
    return jwt.sign(payload, secret, { expiresIn: VIGENCIA })
}

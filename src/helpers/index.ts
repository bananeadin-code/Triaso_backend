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

// --- JWT ---
type JWTPayload = {
    id: string
}

export const generateJWT = (payload: JWTPayload) => {
    const secret = process.env.JWT_SECRET
    if (!secret) {
        throw new Error('Falta la variable de entorno JWT_SECRET')
    }
    return jwt.sign(payload, secret, {
        expiresIn: '30d',
    })
}

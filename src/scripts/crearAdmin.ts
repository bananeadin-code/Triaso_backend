import 'dotenv/config'
import colors from 'colors'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Usuario from '../models/Usuario'
import { hashPassword } from '../helpers'

// Crea el primer usuario administrador si aún no existe ninguno.
// Uso: npx ts-node src/scripts/crearAdmin.ts
const crearAdmin = async () => {
    await connectDB()

    const nombre = 'Administrador'
    const email = 'admin@triaso.com'
    const password = 'admin123'

    const existe = await Usuario.findOne({ email })
    if (existe) {
        console.log(colors.yellow.bold(`El usuario ${email} ya existe. Nada que hacer.`))
        await mongoose.disconnect()
        return
    }

    await Usuario.create({
        nombre,
        email,
        password: await hashPassword(password),
        rol: 'admin',
        activo: true,
    })

    console.log(colors.green.bold('Administrador creado:'))
    console.log(`  correo: ${email}`)
    console.log(`  contraseña: ${password}`)
    console.log(colors.red('Cambia esta contraseña después del primer inicio de sesión.'))

    await mongoose.disconnect()
}

crearAdmin()

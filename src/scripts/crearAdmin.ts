import 'dotenv/config'
import colors from 'colors'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Usuario from '../models/Usuario'
import { hashPassword } from '../helpers'

// Crea el primer administrador o RECUPERA el control si ya no queda ningún admin activo.
// Uso:
//   npx ts-node src/scripts/crearAdmin.ts                         -> admin@triaso.com / admin123
//   npx ts-node src/scripts/crearAdmin.ts correo@x.com clave123   -> con correo/contraseña propios
//   ... --forzar   -> restablece esa cuenta aunque ya exista otro admin activo
//   ... --dev      -> NO pide cambiar la contraseña al entrar (solo para pruebas locales con los scripts)
const crearAdmin = async () => {
    const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
    const forzar = process.argv.includes('--forzar')
    const temporal = !process.argv.includes('--dev')
    const email = (args[0] ?? 'admin@triaso.com').toLowerCase().trim()
    const password = args[1] ?? 'admin123'

    if (password.length < 6) {
        console.log(colors.red.bold('La contraseña debe tener al menos 6 caracteres.'))
        process.exit(1)
    }

    await connectDB()

    const activos = await Usuario.countDocuments({ rol: 'admin', activo: true })
    if (activos > 0 && !forzar) {
        console.log(colors.yellow.bold(`Ya hay ${activos} administrador(es) activo(s). Nada que hacer.`))
        console.log('Usa --forzar para restablecer de todos modos la cuenta indicada.')
        await mongoose.disconnect()
        return
    }

    const existente = await Usuario.findOne({ email })
    if (existente) {
        // Recuperación: vuelve a ser admin activo, contraseña nueva y se cierran sus sesiones viejas
        existente.rol = 'admin'
        existente.activo = true
        existente.password = await hashPassword(password)
        existente.sesionVersion = (existente.sesionVersion ?? 0) + 1
        existente.debeCambiarPassword = temporal
        await existente.save()
        console.log(colors.green.bold('Cuenta restablecida como administrador activo:'))
    } else {
        await Usuario.create({
            nombre: 'Administrador',
            email,
            password: await hashPassword(password),
            rol: 'admin',
            activo: true,
            debeCambiarPassword: temporal,
        })
        console.log(colors.green.bold('Administrador creado:'))
    }
    console.log(`  correo: ${email}`)
    console.log(`  contraseña: ${password}`)
    if (temporal) console.log(colors.red('El sistema te pedirá cambiar esta contraseña al iniciar sesión.'))

    await mongoose.disconnect()
}

crearAdmin()

import 'dotenv/config'
import colors from 'colors'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Usuario from '../models/Usuario'
import { ROLES } from '../config/permisos'

// Migra los usuarios al nuevo esquema de roles/permisos:
//  - rol viejo 'compras' -> 'cotizador'; cualquier rol desconocido -> 'capturista'
//  - agrega el objeto `permisos` (admin/operador con ambos en true; el resto false)
// Uso: npx ts-node src/scripts/migracion02_usuarios.ts
const migrar = async () => {
    await connectDB()
    const usuarios = await Usuario.find()
    let cambiados = 0

    for (const u of usuarios) {
        let toco = false
        const rolActual = u.rol as string

        if (rolActual === 'compras') {
            u.rol = 'cotizador'
            toco = true
        } else if (!ROLES.includes(u.rol)) {
            u.rol = 'capturista'
            toco = true
        }

        const permisosPlenos = u.rol === 'admin' || u.rol === 'operador'
        const permisosActuales = u.permisos as unknown as { limpiarHistoriales?: boolean; generarReportes?: boolean } | undefined
        if (!permisosActuales || permisosActuales.limpiarHistoriales === undefined) {
            u.permisos = {
                limpiarHistoriales: permisosPlenos,
                generarReportes: permisosPlenos,
            } as never
            toco = true
        }

        if (toco) {
            await u.save()
            cambiados++
            console.log(`  ${u.email} -> rol=${u.rol} permisos=${JSON.stringify(u.permisos)}`)
        }
    }

    console.log(colors.green.bold(`Migración de usuarios completa. ${cambiados} de ${usuarios.length} actualizados.`))
    await mongoose.disconnect()
}

migrar()

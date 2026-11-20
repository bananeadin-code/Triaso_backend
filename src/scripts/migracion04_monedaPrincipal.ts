import 'dotenv/config'
import colors from 'colors'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Material from '../models/Material'
import { principalDe } from '../services/moneda'

// Fija `monedaPrincipal` en los materiales existentes según su moneda/costos.
// Uso: npx ts-node src/scripts/migracion04_monedaPrincipal.ts
const migrar = async () => {
    await connectDB()
    const materiales = await Material.find()
    let cambiados = 0
    for (const m of materiales) {
        const esperado = principalDe(m)
        if ((m as { monedaPrincipal?: string }).monedaPrincipal !== esperado) {
            m.monedaPrincipal = esperado
            await m.save()
            cambiados++
        }
    }
    console.log(colors.green.bold(`monedaPrincipal fijada. ${cambiados} de ${materiales.length} actualizados.`))
    await mongoose.disconnect()
}
migrar()

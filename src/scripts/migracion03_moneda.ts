import 'dotenv/config'
import colors from 'colors'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Material from '../models/Material'

// Asigna la `moneda` de compra a los materiales existentes, infiriéndola de sus costos:
//   - costo MXN > 0 y USD > 0  -> 'ambos'
//   - solo USD > 0 (MXN = 0)   -> 'usd'
//   - el resto (incluye sin costo) -> 'mxn'  (era el default histórico)
// No borra ni recalcula costos; solo rellena el campo nuevo si falta.
// Uso: npx ts-node src/scripts/migracion03_moneda.ts
const migrar = async () => {
    await connectDB()
    const materiales = await Material.find()
    let cambiados = 0

    for (const m of materiales) {
        const actual = (m as { moneda?: string }).moneda
        if (actual === 'mxn' || actual === 'usd' || actual === 'ambos') continue // ya tiene

        const mxn = Number(m.costoUnitario) || 0
        const usd = Number(m.costoUSD) || 0
        let moneda: 'mxn' | 'usd' | 'ambos' = 'mxn'
        if (mxn > 0 && usd > 0) moneda = 'ambos'
        else if (usd > 0 && mxn === 0) moneda = 'usd'

        m.moneda = moneda
        await m.save()
        cambiados++
        console.log(`  ${m.clave} ${m.concepto} -> ${moneda} (MXN ${mxn} / USD ${usd})`)
    }

    console.log(colors.green.bold(`Migración de moneda completa. ${cambiados} de ${materiales.length} actualizados.`))
    await mongoose.disconnect()
}

migrar()

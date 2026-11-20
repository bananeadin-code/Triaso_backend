import 'dotenv/config'
import colors from 'colors'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Material from '../models/Material'

// Deja coherentes los materiales de UNA sola moneda: si están marcados como
// 'mxn' (solo pesos) o 'usd' (solo dólares) pero traen un costo en la otra moneda,
// se vacía esa otra (0). Los 'ambos' NO se tocan.
// Uso: npx ts-node src/scripts/migracion05_limpiarMonedaSecundaria.ts
const migrar = async () => {
    await connectDB()
    const materiales = await Material.find()
    let cambiados = 0
    for (const m of materiales) {
        const moneda = (m as { moneda?: string }).moneda
        let toco = false
        if (moneda === 'mxn' && (m.costoUSD || m.importeUSD)) {
            m.costoUSD = 0
            m.importeUSD = 0
            m.monedaPrincipal = 'mxn'
            toco = true
        } else if (moneda === 'usd' && (m.costoUnitario || m.importeMXN)) {
            m.costoUnitario = 0
            m.importeMXN = 0
            m.monedaPrincipal = 'usd'
            toco = true
        }
        if (toco) {
            await m.save()
            cambiados++
            console.log(`  ${m.clave} ${m.concepto} → ${moneda} (secundaria vaciada)`)
        }
    }
    console.log(colors.green.bold(`Limpieza de moneda secundaria completa. ${cambiados} de ${materiales.length} actualizados.`))
    await mongoose.disconnect()
}
migrar()

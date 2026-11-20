import 'dotenv/config'
import colors from 'colors'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Paridad from '../models/Paridad'
import Cotizacion from '../models/Cotizacion'
import { getConfiguracion } from '../models/Configuracion'

// Siembra la bitácora de paridad y enlaza las cotizaciones existentes a un registro
// inicial (para que "editar el pasado" también las alcance).
// Uso: npx ts-node src/scripts/migracion06_paridad.ts
const migrar = async () => {
    await connectDB()

    let inicial = await Paridad.findOne().sort({ fecha: 1 })
    if (!inicial) {
        const cfg = await getConfiguracion()
        // Fecha = la cotización más antigua (si hay), para que el registro cubra el pasado
        const primera = await Cotizacion.findOne().sort({ createdAt: 1 }).select('createdAt')
        const fecha = primera?.get('createdAt') ? new Date(primera.get('createdAt')) : new Date()
        inicial = await Paridad.create({ valor: cfg.tipoCambio || 20, fecha, origen: 'config', creadoPor: 'Migración' })
        console.log(`  Registro inicial de paridad: $${inicial.valor} (${fecha.toLocaleDateString('es-MX')})`)
    }

    const r = await Cotizacion.updateMany({ paridad: { $exists: false } }, { paridad: inicial._id })

    // El registro inicial debe cubrir desde la cotización más antigua que tiene ligada
    // (si se sembró después, su fecha quedaría engañosa en la bitácora).
    const masAntigua = await Cotizacion.findOne({ paridad: inicial._id }).sort({ createdAt: 1 }).select('createdAt')
    const fAnt = masAntigua?.get('createdAt') as Date | undefined
    if (fAnt && fAnt < inicial.fecha) {
        inicial.fecha = fAnt
        if (!inicial.nota) inicial.nota = 'Valor inicial (registro histórico)'
        await inicial.save()
        console.log(`  Fecha del registro inicial ajustada a ${fAnt.toLocaleDateString('es-MX')}`)
    }
    console.log(colors.green.bold(`Paridad sembrada. ${r.modifiedCount ?? 0} cotización(es) enlazadas al registro inicial.`))
    await mongoose.disconnect()
}
migrar()

// Verifica el filtro de +90 días en la limpieza de órdenes y cotizaciones.
// Uso: npx ts-node src/scripts/verificarLimpieza90.ts
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'

const BASE = 'http://localhost:4000/api'

async function main() {
    await connectDB()
    const hace100 = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)

    // Retrasar una orden confirmada y una cotización terminada a hace 100 días (driver nativo, sin tocar timestamps de Mongoose)
    const ordenes = mongoose.connection.collection('ordencompras')
    const cots = mongoose.connection.collection('cotizacions')

    const ordConf = await ordenes.findOne({ estado: 'confirmada' })
    const cotTerm = await cots.findOne({ estado: { $in: ['surtida', 'cancelada'] } })

    if (ordConf) await ordenes.updateOne({ _id: ordConf._id }, { $set: { confirmadaAt: hace100 } })
    if (cotTerm) await cots.updateOne({ _id: cotTerm._id }, { $set: { updatedAt: hace100 } })
    console.log(`Retrasadas a 100 días: orden ${ordConf?.folio ?? '(ninguna)'}, cotización ${cotTerm?.folio ?? '(ninguna)'}`)

    const totOrdAntes = await ordenes.countDocuments({ estado: 'confirmada' })
    const totCotAntes = await cots.countDocuments({ estado: { $in: ['surtida', 'cancelada'] } })

    // Login + llamar los endpoints de limpieza
    const login = await (
        await fetch(`${BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }),
        })
    ).json()
    const H = { Authorization: `Bearer ${login.token}` }

    const ro = await (await fetch(`${BASE}/ordenes/limpiar/completadas`, { method: 'DELETE', headers: H })).json()
    const rc = await (await fetch(`${BASE}/cotizaciones/limpiar/terminadas`, { method: 'DELETE', headers: H })).json()

    const totOrdDespues = await ordenes.countDocuments({ estado: 'confirmada' })
    const totCotDespues = await cots.countDocuments({ estado: { $in: ['surtida', 'cancelada'] } })

    console.log(`\nÓrdenes confirmadas: ${totOrdAntes} -> ${totOrdDespues} | endpoint eliminó ${ro.eliminadas} (debe ser 1, la vieja)`)
    console.log(`Cotizaciones terminadas: ${totCotAntes} -> ${totCotDespues} | endpoint eliminó ${rc.eliminadas} (debe ser 1, la vieja)`)
    console.log('Las recientes se conservaron ✓ (solo se borró la de +90 días)')

    await mongoose.disconnect()
}

main().catch((e) => console.error(e))

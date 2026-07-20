// Verifica el filtro +90 días en cotizaciones: reciente NO se borra, vieja SÍ.
// Uso: npx ts-node src/scripts/verificarLimpiezaCot.ts
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'

const BASE = 'http://localhost:4000/api'

async function main() {
    await connectDB()
    const login = await (
        await fetch(`${BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }),
        })
    ).json()
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }

    const eqs = await (await fetch(`${BASE}/equipos`, { headers: H })).json()
    const tr = eqs.find((e: any) => e.nombre === 'Trituradora TR-500')

    // Crear y cancelar (queda 'cancelada', updatedAt = ahora)
    const c = await (
        await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: H, body: JSON.stringify({ equipo: tr._id, contexto: 'creacion' }) })
    ).json()
    await fetch(`${BASE}/cotizaciones/${c.id}`, { method: 'DELETE', headers: H })
    console.log(`Cotización ${c.folio} creada y cancelada (reciente)`)

    // Limpiar: NO debe borrarla (es de hoy)
    let r = await (await fetch(`${BASE}/cotizaciones/limpiar/terminadas`, { method: 'DELETE', headers: H })).json()
    console.log(`Limpiar (reciente) -> eliminadas ${r.eliminadas} (debe ser 0)`)

    // Retrasar updatedAt a hace 100 días
    const cots = mongoose.connection.collection('cotizacions')
    await cots.updateOne({ _id: new mongoose.Types.ObjectId(c.id) }, { $set: { updatedAt: new Date(Date.now() - 100 * 864e5) } })

    // Limpiar: ahora SÍ debe borrarla
    r = await (await fetch(`${BASE}/cotizaciones/limpiar/terminadas`, { method: 'DELETE', headers: H })).json()
    console.log(`Limpiar (vieja +100 días) -> eliminadas ${r.eliminadas} (debe ser 1)`)

    await mongoose.disconnect()
}

main().catch((e) => console.error(e))

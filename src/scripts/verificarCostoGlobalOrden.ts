// Verifica "actualizar el costo en todo el sistema" desde una orden de compra,
// tanto al CREAR la orden (caso que fallaba) como al EDITARLA, y que el costo
// especial (solo esta orden) NO toque el catálogo.
// Usa un proveedor y un material QA propios y los borra al final (no toca datos reales).
// Uso: npx ts-node src/scripts/verificarCostoGlobalOrden.ts
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Historial from '../models/Historial'
import { cerrarBD } from './_qa'

const BASE = 'http://localhost:4000/api'
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const login = await (
        await fetch(`${BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }),
        })
    ).json()
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }
    const j = async (r: Response) => r.json()
    const cat = async (id: string) => j(await fetch(`${BASE}/materiales/${id}`, { headers: H }))

    // Proveedor + material QA (catálogo: $100 MXN)
    const prov = await j(await fetch(`${BASE}/proveedores`, { method: 'POST', headers: H, body: JSON.stringify({ codigo: 'QACOSTO', razonSocial: 'QA Costos SA' }) }))
    const provId = prov.id ?? prov._id
    const mat = await j(
        await fetch(`${BASE}/materiales`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({ concepto: 'QA material costo global', categoriaPrincipal: 'A', proveedorPrincipal: provId, costoUnitario: 100, moneda: 'mxn' }),
        })
    )
    const matId = mat.id ?? mat._id
    const ordenes: string[] = []

    try {
        console.log(`Material QA creado, catálogo = $${(await cat(matId)).costoUnitario}`)

        // 1) Crear orden con costo ESPECIAL (solo esta orden) → catálogo intacto
        const o1 = await j(await fetch(`${BASE}/ordenes`, { method: 'POST', headers: H, body: JSON.stringify({ proveedor: provId, items: [{ material: matId, cantidad: 1, costoUnitario: 120 }] }) }))
        ordenes.push(o1.id)
        console.log('1) Crear orden con costo especial $120 → catálogo sigue en $100:', ok((await cat(matId)).costoUnitario === 100))

        // 2) Crear orden con costo $150 y "actualizar en todo el sistema" (el caso reportado)
        const o2 = await j(await fetch(`${BASE}/ordenes`, { method: 'POST', headers: H, body: JSON.stringify({ proveedor: provId, items: [{ material: matId, cantidad: 1, costoUnitario: 150 }], materialesGlobal: [matId] }) }))
        ordenes.push(o2.id)
        const c2 = (await cat(matId)).costoUnitario
        console.log(`2) Crear orden con $150 + global → catálogo = $${c2}:`, ok(c2 === 150))

        // 3) Editar el borrador con $175 + global (ruta que ya funcionaba)
        await fetch(`${BASE}/ordenes/${o2.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ items: [{ material: matId, cantidad: 1, costoUnitario: 175 }], materialesGlobal: [matId] }) })
        const c3 = (await cat(matId)).costoUnitario
        console.log(`3) Editar borrador con $175 + global → catálogo = $${c3}:`, ok(c3 === 175))

        // 4) Bitácora de compras registra ambos cambios
        const hist = await j(await fetch(`${BASE}/historial?sector=compras`, { headers: H }))
        const regs = hist.filter((h: any) => String(h.entidad).includes('QA material costo global'))
        console.log(`4) Bitácora registra los 2 cambios globales (${regs.length}):`, ok(regs.length === 2))
    } finally {
        for (const id of ordenes) await fetch(`${BASE}/ordenes/${id}`, { method: 'DELETE', headers: H })
        await fetch(`${BASE}/materiales/${matId}`, { method: 'DELETE', headers: H })
        await fetch(`${BASE}/proveedores/${provId}`, { method: 'DELETE', headers: H })
        // Quitar de la bitácora el rastro de la prueba (altas/bajas/cambios QA)
        if (mongoose.connection.readyState !== 1) await connectDB()
        const r = await Historial.deleteMany({ entidad: { $regex: 'QA material costo global|QACOSTO|QA Costos' } })
        await cerrarBD()
        console.log(`(limpieza: órdenes, material y proveedor QA eliminados; ${r.deletedCount} registro(s) de bitácora QA quitados)`)
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})

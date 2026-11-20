// Verifica los ajustes de esta fase contra el server en :4000:
//  1) Configuración: tipo de cambio (get/put, restaura al final)
//  2) Material con moneda 'usd' (MXN opcional queda en 0)
//  3) Proveedor con bloque bancario (persiste)
//  4) Cotización: total consolidado dual-moneda cuadra con el TC
//  5) Kárdex: endpoint de movimientos responde
// Limpia lo que crea. Uso: npx ts-node src/scripts/verificarAjustesFase.ts
import { borrarCotizacionQA, cerrarBD } from './_qa'
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    if (!a.token) return console.error('No se pudo iniciar sesión (admin@triaso.com / admin123).')
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    // 1) CONFIGURACIÓN
    const cfg0 = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    const tcOriginal = cfg0.tipoCambio
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ tipoCambio: 18.5 }) })
    const cfg1 = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    console.log('1) Config tipoCambio put/get:', ok(cfg1.tipoCambio === 18.5), `(era ${tcOriginal}, ahora ${cfg1.tipoCambio})`)

    // 2) MATERIAL 'usd' → costoUnitario (MXN) debe quedar 0
    const provs = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    const prov = provs[0]
    const nuevoMat = await j(await fetch(`${BASE}/materiales`, { method: 'POST', headers: A, body: JSON.stringify({
        concepto: 'QA Material USD', categoriaPrincipal: 'C', proveedorPrincipal: prov._id,
        moneda: 'usd', costoUnitario: 999, costoUSD: 100,
    }) }))
    const mats = await j(await fetch(`${BASE}/materiales`, { headers: A }))
    const creado = mats.find((m: any) => m._id === nuevoMat.id)
    console.log('2) Material USD: MXN forzado a 0:', ok(creado?.costoUnitario === 0 && creado?.costoUSD === 100 && creado?.moneda === 'usd'),
        `(MXN ${creado?.costoUnitario} USD ${creado?.costoUSD} moneda ${creado?.moneda})`)
    await fetch(`${BASE}/materiales/${nuevoMat.id}`, { method: 'DELETE', headers: A })

    // 3) PROVEEDOR con banco/CLABE
    const nuevoProv = await j(await fetch(`${BASE}/proveedores`, { method: 'POST', headers: A, body: JSON.stringify({
        codigo: 'QAZBANCO', razonSocial: 'QA Banco SA', contacto: 'Juan QA', banco: 'Santander',
        cuenta: '123456789', clabe: '014 580 655 008 753 236', referencia: '999',
    }) }))
    const provDet = await j(await fetch(`${BASE}/proveedores/${nuevoProv.id}`, { headers: A }))
    const p = provDet.proveedor
    console.log('3) Proveedor bancario:', ok(p?.banco === 'Santander' && p?.clabe?.includes('753 236') && p?.contacto === 'Juan QA'),
        `(banco ${p?.banco} contacto ${p?.contacto})`)
    await fetch(`${BASE}/proveedores/${nuevoProv.id}`, { method: 'DELETE', headers: A })

    // 4) COTIZACIÓN: total consolidado cuadra con el TC congelado
    const equipos = await j(await fetch(`${BASE}/equipos`, { headers: A }))
    if (equipos.length > 0) {
        const cot = await j(await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: A, body: JSON.stringify({ equipo: equipos[0]._id, contexto: 'creacion' }) }))
        const d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
        const espMXN = +(d.subtotalMXN + d.subtotalUSD * d.tipoCambio).toFixed(2)
        const espUSD = +(d.subtotalUSD + (d.tipoCambio > 0 ? d.subtotalMXN / d.tipoCambio : 0)).toFixed(2)
        console.log('4) Consolidado MXN cuadra:', ok(Math.abs(d.totalConsolidadoMXN - espMXN) < 0.01),
            `(sub MXN ${d.subtotalMXN} + USD ${d.subtotalUSD}×${d.tipoCambio} = ${d.totalConsolidadoMXN})`)
        console.log('   Consolidado USD cuadra:', ok(Math.abs(d.totalConsolidadoUSD - espUSD) < 0.01), `(= ${d.totalConsolidadoUSD})`)
        console.log('   TC congelado en la cotización:', ok(d.tipoCambio === 18.5), `(${d.tipoCambio})`)
        // limpiar: cancelar + borrar canceladas
        await borrarCotizacionQA(cot.id)
    } else {
        console.log('4) (sin equipos para probar el consolidado)')
    }

    // 5) KÁRDEX: el endpoint responde una lista
    const movs = await fetch(`${BASE}/movimientos`, { headers: A })
    const arr = await j(movs)
    console.log('5) Movimientos (kárdex) responde:', ok(movs.status === 200 && Array.isArray(arr)), `(${arr.length} registros)`)

    // Restaurar TC original
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ tipoCambio: tcOriginal }) })
    console.log('\n(config restaurada a', tcOriginal + ')')
    await cerrarBD()
}

main().catch((e) => console.error(e))

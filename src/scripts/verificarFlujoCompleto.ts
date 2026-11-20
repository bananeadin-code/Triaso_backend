// Testeo de INTEGRACIÓN del flujo completo: BOM → cotizar → órdenes → enviar →
// confirmar recepción (kardex entra) → declarar salida (kardex sale) → reporte.
// Valida que las piezas cuadren entre sí (dinero, stock, trazabilidad, USD).
// Restaura el inventario al terminar. Uso: npx ts-node src/scripts/verificarFlujoCompleto.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }
    const yo = (await j(await fetch(`${BASE}/auth/perfil`, { headers: A }))).nombre

    const eq = (await j(await fetch(`${BASE}/equipos`, { headers: A }))).find((e: any) => e.nombre.includes('TR-500'))
    const bom = await j(await fetch(`${BASE}/equipos/${eq._id}`, { headers: A }))
    console.log(`Equipo ${bom.nombre}: BOM total = ${bom.resumen.totalGeneral.mxn} MXN / ${bom.resumen.totalGeneral.usd} USD`)

    // 1) Crear cotización y comprobar que el dinero CUADRA con el BOM
    const cot = await j(await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: A, body: JSON.stringify({ equipo: eq._id, contexto: 'creacion' }) }))
    let d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    console.log(`\n1) Cotización ${cot.folio}: total ${d.totalReal} MXN / ${d.totalRealUSD} USD`)
    console.log('   Dinero cuadra BOM == cotización (MXN):', ok(Math.abs(d.totalReal - bom.resumen.totalGeneral.mxn) < 0.01))
    console.log('   Dinero cuadra BOM == cotización (USD):', ok(Math.abs(d.totalRealUSD - bom.resumen.totalGeneral.usd) < 0.01))
    console.log('   Trazabilidad creadoPor:', ok(d.creadoPor === yo))

    // 2) Snapshot del inventario y poner TODO faltante (stock 0)
    const inv = await j(await fetch(`${BASE}/inventario`, { headers: A }))
    const ids = [...new Set(d.lineasTabla.flatMap((l: any) => l.materiales.map((m: any) => m.material)).filter(Boolean))] as string[]
    const snap: Record<string, { invId?: string; cantidad: number; creado: boolean }> = {}
    for (const mid of ids) {
        const it = inv.find((i: any) => i.material && String(i.material._id) === String(mid))
        if (it) {
            snap[mid] = { invId: it._id, cantidad: it.cantidad, creado: false }
            await fetch(`${BASE}/inventario/${it._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ cantidad: 0 }) })
        } else {
            const nuevo = await j(await fetch(`${BASE}/inventario`, { method: 'POST', headers: A, body: JSON.stringify({ material: mid, cantidad: 0, ubicacion: 'QA' }) }))
            snap[mid] = { invId: nuevo.id, cantidad: 0, creado: true }
        }
    }

    // 3) Registrar TODAS las órdenes sugeridas, enviarlas y confirmarlas (kardex ENTRA)
    d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    console.log(`\n2) Órdenes sugeridas: ${d.ordenesSugeridas.length} · faltantes agrupados por proveedor`)
    await fetch(`${BASE}/cotizaciones/${cot.id}/ordenes`, { method: 'POST', headers: A })
    const ordenes = (await j(await fetch(`${BASE}/ordenes`, { headers: A }))).filter((o: any) => o.folioCotizacion === cot.folio)
    console.log(`   Registradas: ${ordenes.map((o: any) => o.folio).join(', ')} (creadoPor: ${[...new Set(ordenes.map((o: any) => o.creadoPor))].join('/')})`)
    for (const o of ordenes) {
        await fetch(`${BASE}/ordenes/${o._id}/enviar`, { method: 'PUT', headers: A, body: JSON.stringify({ enviarCorreo: false }) })
        await fetch(`${BASE}/ordenes/${o._id}/confirmar`, { method: 'PUT', headers: A, body: JSON.stringify({ items: [] }) }) // items:[] = recibir todo
    }
    const oc0 = await j(await fetch(`${BASE}/ordenes/${ordenes[0]._id}`, { headers: A }))
    console.log('   Tras confirmar → enviadaPor/confirmadaPor:', ok(oc0.enviadaPor === yo && oc0.confirmadaPor === yo))

    // 4) Ya sin faltantes → declarar salida (kardex SALE)
    d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    const hayFaltantes = d.lineasTabla.some((l: any) => l.materiales.some((m: any) => m.estadoStock !== 'completo'))
    console.log(`\n3) ¿Sin faltantes tras recibir?`, ok(!hayFaltantes))
    const rSal = await fetch(`${BASE}/cotizaciones/${cot.id}/salida`, { method: 'POST', headers: A })
    d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    console.log('   Salida declarada:', ok(rSal.status === 200 && d.estado === 'surtida'), '| surtidaPor:', ok(d.surtidaPor === yo))

    // 5) KARDEX BALANCEA: entró lo requerido y salió lo requerido → vuelve a 0
    const invFinal = await j(await fetch(`${BASE}/inventario`, { headers: A }))
    let balancea = true
    for (const mid of ids) {
        const it = invFinal.find((i: any) => i.material && String(i.material._id) === String(mid))
        const cant = it?.cantidad ?? 0
        if (Math.abs(cant) > 0.01) balancea = false
    }
    console.log('   Kardex balancea (entró = salió, vuelve a 0):', ok(balancea))

    // 6) Reporte de la cotización surtida
    const rep = await fetch(`${BASE}/reportes/cotizacion/${cot.id}`, { headers: A })
    const buf = Buffer.from(await rep.arrayBuffer())
    console.log('\n4) Reporte PDF surtida:', ok(rep.status === 200 && buf.slice(0, 5).toString() === '%PDF-'), `${buf.length} bytes`)

    // 7) Restaurar inventario
    for (const mid of ids) {
        const s = snap[mid]
        if (s.creado && s.invId) await fetch(`${BASE}/inventario/${s.invId}`, { method: 'DELETE', headers: A })
        else if (s.invId) await fetch(`${BASE}/inventario/${s.invId}`, { method: 'PUT', headers: A, body: JSON.stringify({ cantidad: s.cantidad }) })
    }
    console.log('\n(inventario restaurado; la cotización', cot.folio, 'queda surtida como dato demo)')
}

main().catch((e) => console.error(e))

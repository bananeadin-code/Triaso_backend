// Verifica que en el BOM la cantidad sea EFECTIVA (cantidad × costo = importe) cuando
// una línea lleva varias unidades del mismo componente, y que coincida con la cotización.
// Uso: npx ts-node src/scripts/verificarBomCantidades.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    const eq = (await j(await fetch(`${BASE}/equipos`, { headers: A }))).find((e: any) => e.nombre.includes('TR-500'))
    const original = await j(await fetch(`${BASE}/equipos/${eq._id}`, { headers: A }))
    const restaurar = original.lineas.map((l: any) => ({ componente: l.componenteId, variacion: l.variacionId, cantidad: l.cantidad }))

    // Poner la primera línea con 2 unidades del mismo componente
    await fetch(`${BASE}/equipos/${eq._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ lineas: restaurar.map((l: any, i: number) => (i === 0 ? { ...l, cantidad: 2 } : l)) }) })

    const bom = await j(await fetch(`${BASE}/equipos/${eq._id}`, { headers: A }))
    const L = bom.lineas[0]
    console.log(`Componente "${L.componente}" · línea × ${L.cantidad}`)
    let coherentes = true
    for (const m of L.materiales) {
        const calc = +(m.cantidad * m.costoMXN).toFixed(2)
        const bien = Math.abs(calc - m.importeMXN) < 0.01
        if (!bien) coherentes = false
        console.log(`  ${m.clave}: cantidad=${m.cantidad} (unitaria ${m.cantidadUnitaria} × ${L.cantidad}) costo=$${m.costoMXN} importe=$${m.importeMXN} -> ${bien ? 'coherente' : 'INCOHERENTE'}`)
    }
    console.log('Filas coherentes (cantidad × costo = importe):', ok(coherentes))

    // Comparar contra la cotización
    const cot = await j(await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: A, body: JSON.stringify({ equipo: eq._id, contexto: 'creacion' }) }))
    const d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    const cm = d.lineasTabla[0].materiales[0]
    const bm = L.materiales[0]
    console.log(`\nBOM ${bm.clave}: cantidad=${bm.cantidad} importe=$${bm.importeMXN}`)
    console.log(`COT ${cm.clave}: cantidad=${cm.cantidad} importe=$${cm.importeMXN}`)
    console.log('BOM y cotización coinciden:', ok(bm.cantidad === cm.cantidad && bm.importeMXN === cm.importeMXN))
    console.log('Totales coinciden:', ok(bom.resumen.totalGeneral.mxn === d.totalReal), `(${bom.resumen.totalGeneral.mxn} vs ${d.totalReal})`)

    // El reporte PDF debe generarse bien con el desglose
    const rep = await fetch(`${BASE}/reportes/equipo/${eq._id}`, { headers: A })
    const buf = Buffer.from(await rep.arrayBuffer())
    console.log('Reporte BOM PDF:', ok(rep.status === 200 && buf.slice(0, 5).toString() === '%PDF-'), `${buf.length} bytes`)

    await fetch(`${BASE}/cotizaciones/${cot.id}`, { method: 'DELETE', headers: A })
    await fetch(`${BASE}/equipos/${eq._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ lineas: restaurar }) })
    console.log('\n(equipo restaurado)')
}

main().catch((e) => console.error(e))

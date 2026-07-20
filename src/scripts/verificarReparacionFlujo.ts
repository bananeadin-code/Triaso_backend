// Verifica que TODO el flujo nuevo (costo real por material, total real, override manual
// con su gate de faltantes, órdenes sugeridas y re-registro) funciona IGUAL en contexto REPARACIÓN.
// Uso: npx ts-node src/scripts/verificarReparacionFlujo.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()

async function setInv(H: any, id: string, c: number) {
    const r = await fetch(`${BASE}/inventario`, { method: 'POST', headers: H, body: JSON.stringify({ material: id, cantidad: c, ubicacion: 'TEST' }) })
    if (r.status === 409) {
        const inv = await j(await fetch(`${BASE}/inventario`, { headers: H }))
        const it = inv.find((i: any) => i.material && String(i.material._id) === String(id))
        if (it) await fetch(`${BASE}/inventario/${it._id}`, { method: 'PUT', headers: H, body: JSON.stringify({ cantidad: c }) })
    }
}

async function main() {
    const login = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }

    const equipos = await j(await fetch(`${BASE}/equipos`, { headers: H }))
    const trId = (equipos.find((e: any) => (e.nombre || '').includes('TR-500')) || equipos[0])._id
    const eq = await j(await fetch(`${BASE}/equipos/${trId}`, { headers: H }))

    // REPARACIÓN: subconjunto = solo la 2ª línea del equipo
    const sub = eq.lineas.slice(1, 2).map((l: any) => ({ componente: l.componenteId, variacion: l.variacionId, cantidad: l.cantidad }))
    console.log('Reparación con', sub.length, 'de', eq.lineas.length, 'líneas del equipo')

    const cot = await j(await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: H, body: JSON.stringify({ equipo: trId, contexto: 'reparacion', lineas: sub }) }))
    const cotId = cot.id
    console.log('Cotización:', cot.folio, '· contexto:', cot.folio ? 'creada' : '')

    let d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    console.log('contexto en detalle:', d.contexto, '(DEBE reparacion) | líneas:', d.lineasTabla.length)
    const filas = () => d.lineasTabla.flatMap((l: any) => l.materiales)
    const el2 = filas().find((m: any) => m.clave === 'EL0002')
    console.log('Material EL0002 → tiene costoRealMXN:', el2?.costoRealMXN, '| importeReal:', el2?.importeRealMXN, '| fuente:', el2?.fuenteCosto, '| totalReal:', d.totalReal, '| costoManualDefinido:', d.costoManualDefinido)

    // 1) Costo real desde ORDEN: poner EL0002 faltante, registrar orden con costo especial 990 sin propagar
    const ids = [...new Set(filas().map((m: any) => m.material).filter(Boolean))] as string[]
    for (const mid of ids) await setInv(H, mid, filas().find((m: any) => m.material === mid)?.clave === 'EL0002' ? 0 : 500)
    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    const sug = d.ordenesSugeridas.find((o: any) => o.items.some((i: any) => i.clave === 'EL0002'))
    console.log('\n1) Órdenes sugeridas (reparación):', d.ordenesSugeridas.map((o: any) => `${o.codigo}[${o.items.map((i: any) => i.clave).join(',')}]`).join(' ') || '(ninguna)')
    if (sug) {
        await fetch(`${BASE}/cotizaciones/${cotId}/ordenes`, { method: 'POST', headers: H, body: JSON.stringify({ proveedor: sug.proveedor }) })
        const oc = (await j(await fetch(`${BASE}/ordenes`, { headers: H }))).find((o: any) => o.folioCotizacion === cot.folio && o.estado === 'borrador')
        const ocF = await j(await fetch(`${BASE}/ordenes/${oc._id}`, { headers: H }))
        await fetch(`${BASE}/ordenes/${oc._id}`, { method: 'PUT', headers: H, body: JSON.stringify({ items: ocF.items.map((it: any) => ({ material: it.material, cantidad: it.cantidad, costoUnitario: it.clave === 'EL0002' ? 990 : it.costoUnitario })) }) })
        d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
        const el2b = filas().find((m: any) => m.clave === 'EL0002')
        console.log(`   Orden ${oc.folio} costo especial 990 → EL0002 fuente:`, el2b.fuenteCosto, '| costoReal:', el2b.costoRealMXN, '(DEBE 990, de', el2b.fuenteFolio + ')')
    }

    // 2) Gate de costo manual CON faltantes → 409
    const rMalo = await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'PUT', headers: H, body: JSON.stringify({ costoCotizacion: 55555 }) })
    console.log('\n2) Costo manual con faltantes → status', rMalo.status, '(DEBE 409)')

    // 3) Completar stock → costo manual permitido, gana como efectivo
    for (const mid of ids) await setInv(H, mid, 500)
    const rBien = await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'PUT', headers: H, body: JSON.stringify({ costoCotizacion: 55555 }) })
    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    console.log('3) Costo manual sin faltantes → status', rBien.status, '| costoManualDefinido:', d.costoManualDefinido, '| costoCotizacion:', d.costoCotizacion, '(efectivo 55555)')

    // 4) Declarar salida + reporte (surtida)
    const rSal = await fetch(`${BASE}/cotizaciones/${cotId}/salida`, { method: 'POST', headers: H })
    const rep = await fetch(`${BASE}/reportes/cotizacion/${cotId}`, { headers: H })
    const buf = Buffer.from(await rep.arrayBuffer())
    console.log('4) Salida →', rSal.status, '| Reporte reparación →', rep.status, buf.slice(0, 5).toString(), buf.length, 'bytes')

    // Limpieza
    await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'DELETE', headers: H })
    console.log('\nLimpieza: cotización', cot.folio, 'cancelada.')
}

main().catch((e) => console.error(e))

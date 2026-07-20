// Verifica el costo real MANUAL de una cotización:
//  - NO se puede fijar mientras haya faltantes (órdenes/materiales pendientes) → 409
//  - una vez completo, el costo manual GANA sobre el calculado (efectivo + reporte)
//  - "usar calculado" descarta el ajuste manual
// Uso: npx ts-node src/scripts/verificarCostoManual.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()

async function setInv(H: any, materialId: string, cantidad: number) {
    const r = await fetch(`${BASE}/inventario`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ material: materialId, cantidad, ubicacion: 'TEST' }),
    })
    if (r.status === 409) {
        const inv = await j(await fetch(`${BASE}/inventario`, { headers: H }))
        const it = inv.find((i: any) => i.material && String(i.material._id) === String(materialId))
        if (it) await fetch(`${BASE}/inventario/${it._id}`, { method: 'PUT', headers: H, body: JSON.stringify({ cantidad }) })
    }
}

async function main() {
    const login = await j(
        await fetch(`${BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }),
        })
    )
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }

    const equipos = await j(await fetch(`${BASE}/equipos`, { headers: H }))
    const tr = equipos.find((e: any) => (e.nombre || '').includes('TR-500')) || equipos[0]

    // Crear cotización de creación
    const cot = await j(
        await fetch(`${BASE}/cotizaciones`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({ equipo: tr._id, contexto: 'creacion' }),
        })
    )
    const cotId = cot.id
    console.log('Cotización:', cot.folio)

    let d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    const materialIds = [
        ...new Set(d.lineasTabla.flatMap((l: any) => l.materiales.map((m: any) => m.material)).filter(Boolean)),
    ] as string[]
    let hayFaltantes = d.lineasTabla.some((l: any) => l.materiales.some((m: any) => m.estadoStock !== 'completo'))
    console.log('hayFaltantes inicial:', hayFaltantes)

    // A) Intentar fijar costo manual CON faltantes → 409
    const rA = await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'PUT', headers: H, body: JSON.stringify({ costoCotizacion: 12345 }) })
    console.log('A) PUT costo manual con faltantes → status', rA.status, '(DEBE 409)')

    // Completar inventario de TODOS los materiales requeridos
    for (const mid of materialIds) await setInv(H, mid, 500)
    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    hayFaltantes = d.lineasTabla.some((l: any) => l.materiales.some((m: any) => m.estadoStock !== 'completo'))
    console.log('hayFaltantes tras completar stock:', hayFaltantes, '| totalReal(calc):', d.totalReal)

    // B) Fijar costo manual SIN faltantes → 200, gana sobre el calculado
    const rB = await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'PUT', headers: H, body: JSON.stringify({ costoCotizacion: 12345 }) })
    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    console.log('B) PUT costo manual sin faltantes → status', rB.status, '| costoManualDefinido:', d.costoManualDefinido, '| costoCotizacion:', d.costoCotizacion, '(efectivo debe 12345, calc sigue', d.totalReal, ')')

    // C) Usar calculado → descarta el ajuste
    await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'PUT', headers: H, body: JSON.stringify({ usarCalculado: true }) })
    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    console.log('C) usarCalculado → costoManualDefinido:', d.costoManualDefinido, '(DEBE false) → efectivo =', d.totalReal)

    // D) Re-fijar manual, declarar salida y comprobar reporte
    await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'PUT', headers: H, body: JSON.stringify({ costoCotizacion: 99999 }) })
    const rSal = await fetch(`${BASE}/cotizaciones/${cotId}/salida`, { method: 'POST', headers: H })
    console.log('D) Declarar salida → status', rSal.status, '(DEBE 200)')
    const rep = await fetch(`${BASE}/reportes/cotizacion/${cotId}`, { headers: H })
    const buf = Buffer.from(await rep.arrayBuffer())
    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    console.log('   Reporte surtida → status', rep.status, 'bytes', buf.length, 'head', buf.slice(0, 5).toString(), '| costoManualDefinido:', d.costoManualDefinido, '(reporte usa 99999)')

    // Limpieza: cancelar cotización + limpiar inventario TEST
    await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'DELETE', headers: H })
    console.log('\nLimpieza: cotización', cot.folio, 'cancelada. (inventario de prueba quedó en 500, ubicación TEST)')
}

main().catch((e) => console.error(e))

// Verifica unidades configurables y prefijos de folio (órdenes y cotizaciones). Limpia al final.
import { borrarCotizacionQA, cerrarBD } from './_qa'
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    const cfg = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    const unidadesOrig = cfg.unidades
    const foliosOrig = cfg.folios

    // 1) Unidades
    const r1 = await j(await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ unidades: ['Pieza', 'Metro', 'QA-Unidad'] }) }))
    console.log('1) Unidades guardadas:', ok(r1.unidades.includes('QA-Unidad') && r1.unidades.length === 3))

    // 2) Folio de cotización con prefijo nuevo
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ folios: { orden: 'QAOC', cotizacion: 'QACOT' } }) })
    const equipos = await j(await fetch(`${BASE}/equipos`, { headers: A }))
    const cot = await j(await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: A, body: JSON.stringify({ equipo: equipos[0]._id, contexto: 'creacion' }) }))
    console.log('2) Folio de cotización usa el prefijo:', ok(typeof cot.folio === 'string' && cot.folio.startsWith('QACOT')), `(${cot.folio})`)

    // 3) Folio de orden (directa) con prefijo nuevo
    const provs = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    const det = await j(await fetch(`${BASE}/proveedores/${provs[0]._id}`, { headers: A }))
    const mat = det.materiales?.[0]
    let ordFolio = '(sin material para probar)'
    let ordId = ''
    if (mat) {
        const orden = await j(await fetch(`${BASE}/ordenes`, { method: 'POST', headers: A, body: JSON.stringify({ proveedor: provs[0]._id, items: [{ material: mat._id, cantidad: 1 }] }) }))
        ordId = orden.id
        const o = await j(await fetch(`${BASE}/ordenes/${ordId}`, { headers: A }))
        ordFolio = o.folio
        console.log('3) Folio de orden usa el prefijo:', ok(typeof o.folio === 'string' && o.folio.startsWith('QAOC')), `(${o.folio})`)
    } else {
        console.log('3)', ordFolio)
    }

    // Limpieza
    if (ordId) await fetch(`${BASE}/ordenes/${ordId}`, { method: 'DELETE', headers: A })
    await borrarCotizacionQA(cot.id)
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ unidades: unidadesOrig, folios: foliosOrig }) })
    console.log('\n(unidades y folios restaurados; cotización/orden de prueba eliminadas)')
    await cerrarBD()
}
main().catch((e) => console.error(e))

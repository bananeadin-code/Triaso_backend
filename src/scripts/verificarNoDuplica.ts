// Confirma que la cotización YA NO duplica (cada material cuesta en UNA sola moneda).
// Crea una cotización del primer equipo, imprime subtotales y consolidado, y limpia.
import { borrarCotizacionQA, cerrarBD } from './_qa'
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    const equipos = await j(await fetch(`${BASE}/equipos`, { headers: A }))
    if (!equipos.length) return console.log('(sin equipos)')
    const eq = equipos[0]
    const bom = await j(await fetch(`${BASE}/equipos/${eq._id}`, { headers: A }))
    console.log(`Equipo ${bom.nombre}: BOM total = ${bom.resumen.totalGeneral.mxn} MXN / ${bom.resumen.totalGeneral.usd} USD`)

    const cot = await j(await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: A, body: JSON.stringify({ equipo: eq._id, contexto: 'creacion' }) }))
    const d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    console.log(`\nCotización ${cot.folio} (TC ${d.tipoCambio}):`)
    console.log(`  subtotal pesos (materiales que costean en MXN):  ${d.subtotalMXN}`)
    console.log(`  subtotal dólares (materiales que costean en USD): ${d.subtotalUSD}`)
    console.log(`  TOTAL consolidado MXN: ${d.totalConsolidadoMXN}`)
    console.log(`  TOTAL consolidado USD: ${d.totalConsolidadoUSD}`)
    console.log(`\n  → Antes se duplicaba (MXN + USD×TC con AMBOS de cada material).`)
    console.log(`  → Ahora cada material cuenta en UNA sola moneda; el consolidado ya no infla.`)

    await borrarCotizacionQA(cot.id)
    await cerrarBD()
    console.log('\n(cotización de prueba eliminada)')
}
main().catch((e) => console.error(e))

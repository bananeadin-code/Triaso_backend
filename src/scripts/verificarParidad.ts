// Verifica el módulo Paridad: bitácora, valor vigente, enlace cotización↔paridad,
// edición del pasado con re-propagación, guardas y Banxico sin token. Limpia al final.
import { borrarCotizacionQA, cerrarBD } from './_qa'
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    // 1) Bitácora sembrada
    const lista0 = await j(await fetch(`${BASE}/paridad`, { headers: A }))
    console.log('1) Bitácora con registro inicial y cotizaciones ligadas:', ok(lista0.length >= 1 && lista0.some((p: any) => p.cotizaciones > 0)),
        `(${lista0.length} registro(s), ligadas al inicial: ${lista0[lista0.length - 1]?.cotizaciones})`)

    // 2) Nuevo registro de hoy → pasa a ser el vigente
    const nuevo = await j(await fetch(`${BASE}/paridad`, { method: 'POST', headers: A, body: JSON.stringify({ valor: 19.25, nota: 'QA paridad' }) }))
    const cfg = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    console.log('2) Nuevo registro es el vigente:', ok(cfg.tipoCambio === 19.25), `(vigente ${cfg.tipoCambio})`)

    // 3) Cotización nueva se congela con ese valor y se liga al registro
    const equipos = await j(await fetch(`${BASE}/equipos`, { headers: A }))
    const cot = await j(await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: A, body: JSON.stringify({ equipo: equipos[0]._id, contexto: 'creacion' }) }))
    let d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    const lista1 = await j(await fetch(`${BASE}/paridad`, { headers: A }))
    const reg = lista1.find((p: any) => p._id === nuevo.id)
    console.log('3) Cotización congela 19.25 y queda ligada:', ok(d.tipoCambio === 19.25 && reg?.cotizaciones === 1))

    // 4) EDITAR EL PASADO: cambiar el valor re-propaga a la cotización ligada
    const ed = await j(await fetch(`${BASE}/paridad/${nuevo.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ valor: 20.5 }) }))
    d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    const esperado = +(d.subtotalMXN + d.subtotalUSD * 20.5).toFixed(2)
    console.log('4) Editar valor re-propaga:', ok(ed.cotizacionesActualizadas === 1 && d.tipoCambio === 20.5), `(${ed.cotizacionesActualizadas} cotización recalculada)`)
    console.log('   Total consolidado usa el valor editado:', ok(Math.abs(d.totalConsolidadoMXN - esperado) < 0.01))

    // 5) Guarda: no borrar un registro en uso
    const rDel = await fetch(`${BASE}/paridad/${nuevo.id}`, { method: 'DELETE', headers: A })
    console.log('5) Bloquea borrar registro en uso:', ok(rDel.status === 400))

    // 6) Banxico sin token → error claro (no se cae)
    const rB = await fetch(`${BASE}/paridad/traer-hoy`, { method: 'POST', headers: A })
    const b = await j(rB)
    console.log('6) Banxico sin token responde claro:', ok(rB.status === 400 && /token/i.test(b.error)), `("${b.error}")`)

    // Limpieza: borrar la cotización de prueba y luego el registro (ya sin uso)
    await borrarCotizacionQA(cot.id)
    const rDel2 = await fetch(`${BASE}/paridad/${nuevo.id}`, { method: 'DELETE', headers: A })
    const cfgFin = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    console.log('7) Ya sin uso se puede borrar y el vigente regresa al anterior:', ok(rDel2.status === 200 && cfgFin.tipoCambio !== 20.5), `(vigente ${cfgFin.tipoCambio})`)
    await cerrarBD()
}
main().catch((e) => console.error(e))

// Verifica: (1) reseteo de contraseña por el admin, (2) trazabilidad creadoPor en
// cotizaciones y órdenes. (El interceptor 401 es puro frontend, se prueba en navegador.)
// Uso: npx ts-node src/scripts/verificarProduccion.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function login(email: string, password: string) {
    const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    if (r.status !== 200) return null
    const { token } = await r.json()
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

async function main() {
    const A = (await login('admin@triaso.com', 'admin123'))!

    // ===== 1) RESETEO DE CONTRASEÑA =====
    console.log('=== 1) RESETEO DE CONTRASEÑA POR EL ADMIN ===')
    const u = await j(await fetch(`${BASE}/usuarios`, { method: 'POST', headers: A, body: JSON.stringify({ nombre: 'Prueba Reset', email: 't_reset@triaso.com', password: 'inicial123', rol: 'capturista', permisos: { limpiarHistoriales: false, generarReportes: false } }) }))
    console.log('Login con contraseña inicial:', ok((await login('t_reset@triaso.com', 'inicial123')) !== null))

    // El usuario cambia su propia contraseña
    const H = (await login('t_reset@triaso.com', 'inicial123'))!
    await fetch(`${BASE}/auth/perfil/password`, { method: 'PUT', headers: H, body: JSON.stringify({ actual: 'inicial123', nueva: 'suyaPropia1' }) })
    console.log('El usuario cambió su contraseña; login con la suya:', ok((await login('t_reset@triaso.com', 'suyaPropia1')) !== null))

    // El admin la resetea AUNQUE el usuario ya la haya cambiado
    let r = await fetch(`${BASE}/usuarios/${u.id}/password`, { method: 'PUT', headers: A, body: JSON.stringify({ password: 'reseteada99' }) })
    console.log('Admin resetea (con usuario ya cambiado):', r.status, ok(r.status === 200))
    console.log('  Login con la nueva del admin:', ok((await login('t_reset@triaso.com', 'reseteada99')) !== null))
    console.log('  La anterior del usuario YA no sirve:', ok((await login('t_reset@triaso.com', 'suyaPropia1')) === null))

    // Contraseña muy corta -> 400
    r = await fetch(`${BASE}/usuarios/${u.id}/password`, { method: 'PUT', headers: A, body: JSON.stringify({ password: '123' }) })
    console.log('Contraseña < 6 rechazada:', r.status, ok(r.status === 400))

    // Un NO admin no puede resetear a otros
    const N = (await login('t_reset@triaso.com', 'reseteada99'))!
    r = await fetch(`${BASE}/usuarios/${u.id}/password`, { method: 'PUT', headers: N, body: JSON.stringify({ password: 'loquesea1' }) })
    console.log('No-admin intenta resetear -> bloqueado:', r.status, ok(r.status === 403))

    await fetch(`${BASE}/usuarios/${u.id}`, { method: 'DELETE', headers: A })

    // ===== 2) TRAZABILIDAD (creadoPor) =====
    console.log('\n=== 2) TRAZABILIDAD ===')
    const perfil = await j(await fetch(`${BASE}/auth/perfil`, { headers: A }))
    const eq = (await j(await fetch(`${BASE}/equipos`, { headers: A }))).find((e: any) => e.nombre.includes('TR-500'))

    const cot = await j(await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: A, body: JSON.stringify({ equipo: eq._id, contexto: 'creacion' }) }))
    const d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    console.log(`Cotización ${cot.folio} creadaPor: "${d.creadoPor}"`, ok(d.creadoPor === perfil.nombre))

    const provs = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    const mats = await j(await fetch(`${BASE}/materiales`, { headers: A }))
    const oc = await j(await fetch(`${BASE}/ordenes`, { method: 'POST', headers: A, body: JSON.stringify({ proveedor: provs[0]._id, items: [{ material: mats[0]._id, cantidad: 1, costoUnitario: 10 }] }) }))
    await fetch(`${BASE}/ordenes/${oc.id}/enviar`, { method: 'PUT', headers: A, body: JSON.stringify({ enviarCorreo: false }) })
    await fetch(`${BASE}/ordenes/${oc.id}/confirmar`, { method: 'PUT', headers: A, body: JSON.stringify({ items: [] }) })
    const ordFull = await j(await fetch(`${BASE}/ordenes/${oc.id}`, { headers: A }))
    console.log(`Orden ${oc.folio}: creadoPor="${ordFull.creadoPor}" enviadaPor="${ordFull.enviadaPor}" confirmadaPor="${ordFull.confirmadaPor}"`)
    console.log('Registra los 3 responsables:', ok(ordFull.creadoPor === perfil.nombre && ordFull.enviadaPor === perfil.nombre && ordFull.confirmadaPor === perfil.nombre))

    const lista = await j(await fetch(`${BASE}/ordenes`, { headers: A }))
    console.log('creadoPor aparece en la LISTA de órdenes:', ok(lista.find((o: any) => o._id === oc.id)?.creadoPor === perfil.nombre))

    // limpieza
    await fetch(`${BASE}/cotizaciones/${cot.id}`, { method: 'DELETE', headers: A })
    await fetch(`${BASE}/ordenes/${oc.id}`, { method: 'DELETE', headers: A })
    console.log('\n(limpieza hecha)')
}

main().catch((e) => console.error(e))

// Verifica el rol Comprador y las guardas de auto-gestión del admin.
// Uso: npx ts-node src/scripts/verificarCompradorYGuardas.ts
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
async function code(H: any, method: string, path: string, body?: any) {
    const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
    return r.status
}

async function main() {
    const A = (await login('admin@triaso.com', 'admin123'))!
    const yo = await j(await fetch(`${BASE}/auth/perfil`, { headers: A }))

    // ===== Guardas de auto-gestión del admin =====
    console.log('=== GUARDAS DEL ADMIN SOBRE SÍ MISMO ===')
    console.log('Cambiarse su propio rol (bloq):', ok((await code(A, 'PUT', `/usuarios/${yo._id}`, { rol: 'capturista' })) === 409))
    console.log('Desactivarse a sí mismo (bloq):', ok((await code(A, 'PUT', `/usuarios/${yo._id}`, { activo: false })) === 409))
    console.log('Eliminarse a sí mismo (bloq):  ', ok((await code(A, 'DELETE', `/usuarios/${yo._id}`)) === 409))
    const sigue = await j(await fetch(`${BASE}/auth/perfil`, { headers: A }))
    console.log('Sigue siendo admin y activo:   ', ok(sigue.rol === 'admin' && sigue.activo === true))

    // ===== Rol Comprador =====
    console.log('\n=== ROL COMPRADOR ===')
    const c = await j(await fetch(`${BASE}/usuarios`, { method: 'POST', headers: A, body: JSON.stringify({ nombre: 'Comprador Demo', email: 't_comprador@triaso.com', password: 'clave123', rol: 'comprador', debeCambiarPassword: false, permisos: { limpiarHistoriales: false, generarReportes: true } }) }))
    const H = (await login('t_comprador@triaso.com', 'clave123'))!
    const p = await j(await fetch(`${BASE}/auth/perfil`, { headers: H }))
    console.log('Menú:', JSON.stringify(p.nav), '| panel:', p.panel)
    console.log('Acceso:', JSON.stringify(p.acceso))

    console.log('\nPermitido:')
    console.log('  GET  /ordenes      :', ok((await code(H, 'GET', '/ordenes')) === 200))
    console.log('  GET  /proveedores  :', ok((await code(H, 'GET', '/proveedores')) === 200))
    console.log('  GET  /materiales   :', ok((await code(H, 'GET', '/materiales')) === 200))
    console.log('  GET  /recomendaciones:', ok((await code(H, 'GET', '/recomendaciones')) === 200))
    console.log('  GET  /reportes/ordenes (con permiso):', ok((await code(H, 'GET', '/reportes/ordenes')) === 200))

    console.log('\nBloqueado:')
    console.log('  GET  /cotizaciones :', ok((await code(H, 'GET', '/cotizaciones')) === 403))
    console.log('  GET  /inventario   :', ok((await code(H, 'GET', '/inventario')) === 403))
    console.log('  GET  /equipos      :', ok((await code(H, 'GET', '/equipos')) === 403))
    console.log('  GET  /componentes  :', ok((await code(H, 'GET', '/componentes')) === 403))
    console.log('  GET  /historial    :', ok((await code(H, 'GET', '/historial')) === 403))
    console.log('  GET  /usuarios     :', ok((await code(H, 'GET', '/usuarios')) === 403))
    console.log('  Limpieza masiva de órdenes retirada (404):', ok((await code(H, 'DELETE', '/ordenes/limpiar/completadas')) === 404))

    await fetch(`${BASE}/usuarios/${c.id}`, { method: 'DELETE', headers: A })
    console.log('\n(usuario de prueba eliminado)')
}

main().catch((e) => console.error(e))

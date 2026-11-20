// Verifica el control de acceso por rol (backend): módulos, permisos transversales y auto-perfil.
// Uso: npx ts-node src/scripts/verificarPermisos.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()

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
const ok = (cond: boolean) => (cond ? 'OK' : '❌ FALLO')

async function main() {
    const A = await login('admin@triaso.com', 'admin123')
    if (!A) return console.log('No se pudo entrar como admin')

    // perfil admin
    const perfil = await j(await fetch(`${BASE}/auth/perfil`, { headers: A }))
    console.log('Perfil admin → rol:', perfil.rol, '| panel:', perfil.panel, '| nav:', perfil.nav.length, 'módulos | permisos:', JSON.stringify(perfil.permisos))

    // Crear un usuario de cada rol (sin permisos extra, salvo donde se indica)
    const defs = [
        { rol: 'operador', email: 't_operador@triaso.com', permisos: { limpiarHistoriales: false, generarReportes: false } },
        { rol: 'cotizador', email: 't_cotizador@triaso.com', permisos: { limpiarHistoriales: false, generarReportes: false } },
        { rol: 'capturista', email: 't_capturista@triaso.com', permisos: { limpiarHistoriales: false, generarReportes: true } },
        { rol: 'almacenista', email: 't_almacenista@triaso.com', permisos: { limpiarHistoriales: false, generarReportes: false } },
    ]
    const ids: Record<string, string> = {}
    for (const d of defs) {
        const r = await fetch(`${BASE}/usuarios`, { method: 'POST', headers: A, body: JSON.stringify({ nombre: d.rol, email: d.email, password: 'clave123', rol: d.rol, debeCambiarPassword: false, permisos: d.permisos }) })
        const body = await r.json()
        ids[d.rol] = body.id ?? ''
        console.log(`Crear ${d.rol}: ${r.status}`)
    }

    const H: Record<string, any> = {}
    for (const d of defs) H[d.rol] = await login(d.email, 'clave123')

    console.log('\n=== ACCESOS ESPERADOS ===')
    // Almacenista: inventario total, cotizaciones SOLO lectura, sin órdenes
    console.log('Almacenista GET inventario:', ok((await code(H.almacenista, 'GET', '/inventario')) === 200))
    console.log('Almacenista GET cotizaciones (ver):', ok((await code(H.almacenista, 'GET', '/cotizaciones')) === 200))
    console.log('Almacenista POST cotización (bloq):', ok((await code(H.almacenista, 'POST', '/cotizaciones', { equipo: '000000000000000000000000' })) === 403))
    console.log('Almacenista GET órdenes (bloq):', ok((await code(H.almacenista, 'GET', '/ordenes')) === 403))
    console.log('Almacenista GET usuarios (bloq):', ok((await code(H.almacenista, 'GET', '/usuarios')) === 403))

    // Cotizador: cotizaciones/órdenes/equipos sí; inventario lectura sí; escribir inventario no; usuarios no
    console.log('Cotizador GET cotizaciones:', ok((await code(H.cotizador, 'GET', '/cotizaciones')) === 200))
    console.log('Cotizador GET órdenes:', ok((await code(H.cotizador, 'GET', '/ordenes')) === 200))
    console.log('Cotizador GET inventario (lectura interna):', ok((await code(H.cotizador, 'GET', '/inventario')) === 200))
    console.log('Cotizador POST inventario (bloq):', ok((await code(H.cotizador, 'POST', '/inventario', { material: '000000000000000000000000', cantidad: 1 })) === 403))
    console.log('Cotizador DELETE limpiar canceladas SIN permiso (bloq):', ok((await code(H.cotizador, 'DELETE', '/cotizaciones/limpiar/canceladas')) === 403))
    console.log('Cotizador GET reporte SIN permiso (bloq):', ok((await code(H.cotizador, 'GET', '/reportes/ordenes')) === 403))

    // Capturista: catálogos sí; cotizaciones/órdenes no; reporte con permiso sí
    console.log('Capturista GET materiales:', ok((await code(H.capturista, 'GET', '/materiales')) === 200))
    console.log('Capturista GET cotizaciones (bloq):', ok((await code(H.capturista, 'GET', '/cotizaciones')) === 403))
    console.log('Capturista GET reporte materiales CON permiso:', ok((await code(H.capturista, 'GET', '/reportes/materiales')) === 200))

    // Operador: todo menos usuarios
    console.log('Operador GET cotizaciones:', ok((await code(H.operador, 'GET', '/cotizaciones')) === 200))
    console.log('Operador GET inventario:', ok((await code(H.operador, 'GET', '/inventario')) === 200))
    console.log('Operador GET reporte (permiso auto):', ok((await code(H.operador, 'GET', '/reportes/ordenes')) === 200))
    console.log('Operador GET usuarios (bloq):', ok((await code(H.operador, 'GET', '/usuarios')) === 403))

    // Auto-perfil (cotizador cambia su nombre y contraseña)
    console.log('\n=== AUTO-PERFIL (cotizador) ===')
    console.log('Cambiar nombre:', ok((await code(H.cotizador, 'PUT', '/auth/perfil', { nombre: 'Cotizador Editado' })) === 200))
    console.log('Cambiar contraseña con actual MALA (bloq):', ok((await code(H.cotizador, 'PUT', '/auth/perfil/password', { actual: 'malísima', nueva: 'nueva123' })) === 401))
    console.log('Cambiar contraseña con actual OK:', ok((await code(H.cotizador, 'PUT', '/auth/perfil/password', { actual: 'clave123', nueva: 'nueva123' })) === 200))
    console.log('Login con la NUEVA contraseña:', ok((await login('t_cotizador@triaso.com', 'nueva123')) !== null))

    // Limpieza: borrar usuarios de prueba
    console.log('\n=== LIMPIEZA ===')
    for (const rol of Object.keys(ids)) {
        if (ids[rol]) await fetch(`${BASE}/usuarios/${ids[rol]}`, { method: 'DELETE', headers: A })
    }
    console.log('Usuarios de prueba eliminados.')
}

main().catch((e) => console.error(e))

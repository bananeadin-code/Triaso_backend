// Verifica los permisos CRUD por usuario (override sobre el paquete del rol).
// Las escrituras van contra un id INEXISTENTE: si el permiso pasa → 404; si no → 403.
// Así se prueba el middleware sin tocar datos reales. Limpia al final.
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')
const FAKE = '000000000000000000000000'

async function main() {
    const la = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${la.token}` }

    // Usuario de prueba con rol capturista (paquete: equipos/componentes/materiales/proveedores TOTAL)
    const email = 'qa.permisos@triaso.test'
    const nuevo = await j(await fetch(`${BASE}/usuarios`, { method: 'POST', headers: A, body: JSON.stringify({ nombre: 'QA Permisos', email, password: 'qa1234', rol: 'capturista', permisos: {} }) }))
    const lu = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'qa1234' }) }))
    const U = { 'Content-Type': 'application/json', Authorization: `Bearer ${lu.token}` }
    const st = async (m: string, p: string) => (await fetch(`${BASE}${p}`, { method: m, headers: U, body: m === 'GET' || m === 'DELETE' ? undefined : '{}' })).status

    console.log('— Con el paquete del rol (capturista) —')
    console.log('Eliminar material permitido (404):', ok((await st('DELETE', `/materiales/${FAKE}`)) === 404))
    console.log('Ver proveedores permitido:', ok((await st('GET', '/proveedores')) === 200))

    // Personalizar: materiales sin eliminar; proveedores sin acceso; inventario solo ver (fuera del paquete)
    const accesos = {
        materiales: { menu: true, ver: true, crear: true, editar: true, eliminar: false },
        equipos: { menu: true, ver: true, crear: false, editar: false, eliminar: false },
        inventario: { menu: false, ver: true },
    }
    await fetch(`${BASE}/usuarios/${nuevo.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ accesosPersonalizados: true, accesos }) })

    console.log('\n— Personalizado —')
    console.log('Ver materiales:', ok((await st('GET', '/materiales')) === 200))
    console.log('Editar material (404 = permitido):', ok((await st('PUT', `/materiales/${FAKE}`)) === 404))
    console.log('Eliminar material BLOQUEADO (403):', ok((await st('DELETE', `/materiales/${FAKE}`)) === 403))
    console.log('Proveedores BLOQUEADO (403):', ok((await st('GET', '/proveedores')) === 403))
    console.log('Equipos solo ver: GET 200 / PUT 403:', ok((await st('GET', '/equipos')) === 200 && (await st('PUT', `/equipos/${FAKE}`)) === 403))
    console.log('Inventario (fuera del paquete) ver 200 / crear 403:', ok((await st('GET', '/inventario')) === 200 && (await st('POST', '/inventario')) === 403))
    const perfil = await j(await fetch(`${BASE}/auth/perfil`, { headers: U }))
    console.log('Perfil: menú sin proveedores ni inventario, marca personalizado:',
        ok(perfil.personalizado === true && perfil.nav.includes('materiales') && !perfil.nav.includes('proveedores') && !perfil.nav.includes('inventario')),
        `(nav: ${perfil.nav.join(', ')})`)
    console.log('Perfil: operaciones.materiales.eliminar = false:', ok(perfil.operaciones?.materiales?.eliminar === false))

    // Regresar al paquete del rol
    await fetch(`${BASE}/usuarios/${nuevo.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ accesosPersonalizados: false }) })
    console.log('\n— De vuelta al paquete —')
    console.log('Eliminar material permitido otra vez (404):', ok((await st('DELETE', `/materiales/${FAKE}`)) === 404))
    console.log('Proveedores de nuevo (200):', ok((await st('GET', '/proveedores')) === 200))

    // Bitácora
    const hist = await j(await fetch(`${BASE}/historial?sector=sistema`, { headers: A }))
    const reg = hist.find((h: any) => h.entidad === 'Permisos de QA Permisos')
    console.log('\nBitácora registra el cambio de permisos:', ok(!!reg), reg ? `(${reg.cambios.slice(0, 3).join(' | ')})` : '')

    // Limpieza
    await fetch(`${BASE}/usuarios/${nuevo.id}`, { method: 'DELETE', headers: A })
    console.log('(usuario de prueba eliminado)')
}
main().catch((e) => console.error(e))

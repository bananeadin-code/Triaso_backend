// Verifica que la bitácora registre acciones de varios módulos con su sector/acción,
// y que el filtro por sector funcione. Limpia lo que crea.
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    // 1) Alta de proveedor → catálogos/creó
    const nuevo = await j(await fetch(`${BASE}/proveedores`, { method: 'POST', headers: A, body: JSON.stringify({ codigo: 'QAHIST', razonSocial: 'QA Historial SA' }) }))
    // 2) Edición → catálogos/editó
    await fetch(`${BASE}/proveedores/${nuevo.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ banco: 'Santander' }) })
    // 3) Cambio de tipo de cambio → sistema/editó
    const cfg = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    const tcOrig = cfg.tipoCambio
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ tipoCambio: tcOrig + 0.03 }) })

    // Leer por sector
    const cat = await j(await fetch(`${BASE}/historial?sector=catalogos`, { headers: A }))
    const sis = await j(await fetch(`${BASE}/historial?sector=sistema`, { headers: A }))
    const alta = cat.find((h: any) => h.accion === 'creo' && h.entidad?.includes('QAHIST'))
    const edic = cat.find((h: any) => h.accion === 'edito' && h.entidad?.includes('QAHIST'))
    const tc = sis.find((h: any) => h.entidad === 'Tipo de cambio')

    console.log('Alta de proveedor en Catálogos/creó:', ok(!!alta && alta.tipo === 'proveedor' && alta.sector === 'catalogos'))
    console.log('Edición de proveedor en Catálogos/editó:', ok(!!edic && edic.cambios.some((c: string) => c.includes('Banco'))))
    console.log('Cambio de TC en Sistema/editó:', ok(!!tc && tc.sector === 'sistema'))
    console.log('El filtro por sector NO mezcla:', ok(cat.every((h: any) => h.sector === 'catalogos') && sis.every((h: any) => h.sector === 'sistema')))

    // Limpieza
    await fetch(`${BASE}/proveedores/${nuevo.id}`, { method: 'DELETE', headers: A }) // esto genera un registro 'elimino' (esperado)
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ tipoCambio: tcOrig }) })
    console.log('\n(limpieza: QAHIST borrado, TC restaurado a', tcOrig + ')')
}
main().catch((e) => console.error(e))

// Verifica que las categorías (nombre + prefijo) sean editables y que la clave nueva
// use el prefijo configurado. Restaura todo al final.
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    const cfg = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    const original = cfg.categorias
    const catD = original.find((c: any) => c.id === 'D')
    console.log('Categoría D original:', JSON.stringify(catD))

    // Cambia D: nombre + prefijo → ELX
    const editadas = original.map((c: any) => (c.id === 'D' ? { ...c, nombre: 'Electrónica QA', prefijo: 'ELX' } : c))
    const put = await j(await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ categorias: editadas }) }))
    const dNueva = put.categorias.find((c: any) => c.id === 'D')
    console.log('Guardó D con prefijo ELX y nombre nuevo:', ok(dNueva?.prefijo === 'ELX' && dNueva?.nombre === 'Electrónica QA'))

    // El endpoint de categorías del catálogo lo refleja
    const catCatalogo = await j(await fetch(`${BASE}/materiales/categorias`, { headers: A }))
    console.log('Selects del catálogo reflejan el cambio:', ok(catCatalogo.find((c: any) => c.id === 'D')?.prefijo === 'ELX'))

    // Crea un material categoría D → clave debe empezar con ELX
    const provs = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    const nuevo = await j(await fetch(`${BASE}/materiales`, { method: 'POST', headers: A, body: JSON.stringify({ concepto: 'QA Cat Config', categoriaPrincipal: 'D', proveedorPrincipal: provs[0]._id, moneda: 'mxn', costoUnitario: 10 }) }))
    console.log('Clave nueva usa el prefijo configurado:', ok(typeof nuevo.clave === 'string' && nuevo.clave.startsWith('ELX')), `(clave ${nuevo.clave})`)

    // Rechaza prefijo repetido
    const dupe = original.map((c: any) => (c.id === 'E' ? { ...c, prefijo: original.find((x: any) => x.id === 'A').prefijo } : c))
    const rDup = await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ categorias: dupe }) })
    console.log('Rechaza prefijos repetidos:', ok(rDup.status === 400))

    // Limpieza: borrar el material y restaurar categorías
    if (nuevo.id) await fetch(`${BASE}/materiales/${nuevo.id}`, { method: 'DELETE', headers: A })
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ categorias: original }) })
    console.log('\n(limpieza: material QA borrado, categorías restauradas)')
}
main().catch((e) => console.error(e))

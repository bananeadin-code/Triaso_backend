// Verifica agregar/eliminar categorías + la guarda de borrado (no borrar en uso).
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    const cfg = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    const original = cfg.categorias
    console.log('Categorías originales:', original.map((c: any) => `${c.id}/${c.prefijo}`).join(' '))

    // 1) AGREGAR una categoría nueva (id vacío → el backend le asigna uno)
    const conNueva = [...original, { id: '', nombre: 'Empaque QA', prefijo: 'QN' }]
    const r1 = await j(await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ categorias: conNueva }) }))
    const nueva = r1.categorias.find((c: any) => c.prefijo === 'QN')
    console.log('1) Categoría agregada con id nuevo:', ok(!!nueva && !!nueva.id && nueva.id !== ''), `(id ${nueva?.id})`)

    // 2) Crear material en la categoría nueva → clave con prefijo QN
    const provs = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    const mat = await j(await fetch(`${BASE}/materiales`, { method: 'POST', headers: A, body: JSON.stringify({ concepto: 'QA Empaque', categoriaPrincipal: nueva.id, proveedorPrincipal: provs[0]._id, moneda: 'mxn', costoUnitario: 5 }) }))
    console.log('2) Material en la categoría nueva (clave con prefijo):', ok(mat.clave?.startsWith('QN')), `(clave ${mat.clave})`)

    // 3) Intentar ELIMINAR la categoría en uso → debe bloquear (400)
    const sinNueva = original // la lista sin la nueva
    const rDel = await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ categorias: sinNueva }) })
    console.log('3) Bloquea borrar categoría EN USO:', ok(rDel.status === 400))

    // 4) Borrar el material y AHORA sí eliminar la categoría → éxito
    await fetch(`${BASE}/materiales/${mat.id}`, { method: 'DELETE', headers: A })
    const rDel2 = await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ categorias: sinNueva }) })
    const cfgFin = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    console.log('4) Elimina categoría libre:', ok(rDel2.status === 200 && !cfgFin.categorias.some((c: any) => c.prefijo === 'QN')))

    // Restaurar por si acaso
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ categorias: original }) })
    console.log('\n(categorías restauradas a las originales)')
}
main().catch((e) => console.error(e))

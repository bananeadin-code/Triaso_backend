// Verifica los campos personalizados (informativos) de Materiales: definir, capturar
// en un material, filtrar junk y tipar. Limpia al final.
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    // 1) Definir 2 campos: Norma (texto) y Crítico (siNo)
    const lista = [
        { id: '', nombre: 'Norma QA', tipo: 'texto', opciones: [], activo: true },
        { id: '', nombre: 'Crítico QA', tipo: 'siNo', opciones: [], activo: true },
    ]
    const r1 = await j(await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ campos: { modulo: 'materiales', lista } }) }))
    const defs = r1.campos.materiales
    const norma = defs.find((c: any) => c.nombre === 'Norma QA')
    const critico = defs.find((c: any) => c.nombre === 'Crítico QA')
    console.log('1) Campos definidos con id:', ok(!!norma?.id && !!critico?.id), `(${norma?.id}, ${critico?.id})`)

    // 2) El endpoint del catálogo los expone (activos)
    const activos = await j(await fetch(`${BASE}/materiales/campos`, { headers: A }))
    console.log('2) Catálogo expone los campos activos:', ok(activos.length >= 2))

    // 3) Crear material con valores + junk (debe filtrarse y tipar)
    const provs = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    const nuevo = await j(await fetch(`${BASE}/materiales`, { method: 'POST', headers: A, body: JSON.stringify({
        concepto: 'QA Campos', categoriaPrincipal: 'A', proveedorPrincipal: provs[0]._id, moneda: 'mxn', costoUnitario: 1,
        personalizados: { [norma.id]: 'ASTM A36', [critico.id]: true, campoInexistente: 'basura' },
    }) }))
    const mats = await j(await fetch(`${BASE}/materiales`, { headers: A }))
    const mat = mats.find((m: any) => m._id === nuevo.id)
    const p = mat?.personalizados ?? {}
    console.log('3) Valor de texto guardado:', ok(p[norma.id] === 'ASTM A36'))
    console.log('   Valor siNo tipado a booleano:', ok(p[critico.id] === true))
    console.log('   Junk (campo inexistente) filtrado:', ok(p.campoInexistente === undefined))

    // Limpieza
    await fetch(`${BASE}/materiales/${nuevo.id}`, { method: 'DELETE', headers: A })
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ campos: { modulo: 'materiales', lista: [] } }) })
    console.log('\n(limpieza: material QA borrado, campos removidos)')
}
main().catch((e) => console.error(e))

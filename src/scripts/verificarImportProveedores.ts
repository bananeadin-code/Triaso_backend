// Verifica el endpoint POST /proveedores/importar (upsert por código, tolerante).
// Prueba: 1 nuevo, 1 que actualiza a uno existente, 1 sin código (omitido). Limpia al final.
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    const provs = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    const existente = provs[0] // p. ej. ACEROS
    const refOriginal = existente.referencia ?? ''

    const lote = [
        { codigo: 'QAIMP1', razonSocial: 'QA Import Uno SA', banco: 'Santander', clabe: '111', contacto: 'Ana QA' },
        { codigo: existente.codigo, razonSocial: existente.razonSocial, referencia: 'QATESTREF' }, // actualiza
        { razonSocial: 'Sin código SA' }, // omitido
    ]
    const res = await j(await fetch(`${BASE}/proveedores/importar`, { method: 'POST', headers: A, body: JSON.stringify({ proveedores: lote }) }))
    console.log('Resultado:', JSON.stringify(res))
    console.log('Creados = 1:', ok(res.creados === 1))
    console.log('Actualizados = 1:', ok(res.actualizados === 1))
    console.log('Omitidos = 1 (sin código):', ok(res.omitidos?.length === 1 && res.omitidos[0].motivo === 'Sin código'))

    // Comprobar que el nuevo existe con sus datos
    const desp = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    const nuevo = desp.find((p: any) => p.codigo === 'QAIMP1')
    console.log('Nuevo con banco/contacto:', ok(nuevo?.banco === 'Santander' && nuevo?.contacto === 'Ana QA'))
    const actualizado = desp.find((p: any) => p.codigo === existente.codigo)
    console.log('Existente actualizó referencia:', ok(actualizado?.referencia === 'QATESTREF'))

    // Limpieza: borrar el nuevo y restaurar la referencia del existente
    if (nuevo) await fetch(`${BASE}/proveedores/${nuevo._id}`, { method: 'DELETE', headers: A })
    await fetch(`${BASE}/proveedores/${existente._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ referencia: refOriginal }) })
    console.log('\n(limpieza: QAIMP1 borrado, referencia de', existente.codigo, 'restaurada)')
}
main().catch((e) => console.error(e))

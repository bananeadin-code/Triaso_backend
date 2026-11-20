// Verifica que los datos de empresa lleguen al encabezado de los PDF:
// genera el reporte SIN datos y CON datos; con datos el PDF debe pesar más (texto extra).
// Restaura al final.
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function bytes(A: Record<string, string>) {
    const r = await fetch(`${BASE}/reportes/proveedores`, { headers: A })
    const b = Buffer.from(await r.arrayBuffer())
    return { status: r.status, firma: b.slice(0, 5).toString(), len: b.length }
}

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    const cfg = await j(await fetch(`${BASE}/configuracion`, { headers: A }))
    const original = cfg.empresa

    // Sin datos
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ empresa: { razonSocial: '', rfc: '', direccion: '', telefono: '' } }) })
    const sin = await bytes(A)

    // Con datos
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ empresa: { razonSocial: 'Triaso s.a. de c.v.', rfc: 'TRI900101ABC', direccion: 'Blvd. Durango 123, Durango, Dgo.', telefono: '(618) 100 2000' } }) })
    const con = await bytes(A)
    // El endpoint de config refleja lo guardado
    const cfg2 = await j(await fetch(`${BASE}/configuracion`, { headers: A }))

    console.log('PDF sin datos:', sin, '| con datos:', con)
    console.log('Reporte válido en ambos:', ok(sin.firma === '%PDF-' && con.firma === '%PDF-'))
    console.log('Con datos el PDF pesa más (texto agregado):', ok(con.len > sin.len))
    console.log('Config guardó la razón social:', ok(cfg2.empresa?.razonSocial === 'Triaso s.a. de c.v.' && cfg2.empresa?.rfc === 'TRI900101ABC'))

    // Restaurar
    await fetch(`${BASE}/configuracion`, { method: 'PUT', headers: A, body: JSON.stringify({ empresa: original }) })
    console.log('\n(datos de empresa restaurados)')
}
main().catch((e) => console.error(e))

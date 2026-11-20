// Confirma que un ajuste manual de inventario DEJA RASTRO en el kárdex.
// Toma un renglón, lo sube +1 con motivo, verifica el movimiento y lo regresa.
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    const inv = await j(await fetch(`${BASE}/inventario`, { headers: A }))
    const it = inv.find((i: any) => i.material)
    if (!it) return console.log('(no hay inventario para probar)')
    const matId = it.material._id
    const antes = it.cantidad

    await fetch(`${BASE}/inventario/${it._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ cantidad: antes + 1, motivo: 'QA prueba de kárdex' }) })
    const movs = await j(await fetch(`${BASE}/movimientos?material=${matId}`, { headers: A }))
    const ultimo = movs[0]
    console.log('Ajuste registrado:', ok(ultimo && ultimo.tipo === 'ajuste' && ultimo.saldoAnterior === antes && ultimo.saldoNuevo === antes + 1 && ultimo.motivo === 'QA prueba de kárdex'),
        ultimo ? `(${ultimo.tipo} ${ultimo.saldoAnterior}→${ultimo.saldoNuevo} · "${ultimo.motivo}" · por ${ultimo.usuario})` : '(sin movimiento)')

    // Regresar el stock a como estaba
    await fetch(`${BASE}/inventario/${it._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ cantidad: antes, motivo: 'QA revertir' }) })
    console.log('(stock regresado a', antes + ')')
}

main().catch((e) => console.error(e))

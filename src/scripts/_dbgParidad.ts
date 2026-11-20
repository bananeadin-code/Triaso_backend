export {}
const B = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
async function main() {
    const a = await j(await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }
    const lista = await j(await fetch(`${B}/paridad`, { headers: A }))
    console.log('Registros:', lista.map((p: any) => `${p._id.slice(-4)} $${p.valor} cot=${p.cotizaciones} nota=${p.nota}`))
    const cots = await j(await fetch(`${B}/cotizaciones`, { headers: A }))
    console.log('Cotizaciones canceladas restantes:', cots.filter((c: any) => c.estado === 'cancelada').map((c: any) => c.folio))
    const qa = lista.find((p: any) => p.nota === 'QA paridad')
    if (qa) {
        const r = await fetch(`${B}/paridad/${qa._id}`, { method: 'DELETE', headers: A })
        console.log('DELETE QA →', r.status, JSON.stringify(await j(r)))
    }
}
main()

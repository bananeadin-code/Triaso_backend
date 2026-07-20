// Verifica que los 6 reportes PDF se generen válidos.
// Uso: npx ts-node src/scripts/verificarReportes.ts
export {}
const BASE = 'http://localhost:4000/api'

async function pdf(path: string, H: Record<string, string>) {
    const r = await fetch(`${BASE}/reportes/${path}`, { headers: H })
    const ct = r.headers.get('content-type')
    if (!ct?.includes('pdf')) {
        const t = await r.text()
        return `${path} -> HTTP ${r.status} (${ct}) ${t.slice(0, 80)}`
    }
    const buf = Buffer.from(await r.arrayBuffer())
    const magic = buf.slice(0, 5).toString('latin1')
    return `${path} -> ${buf.length} bytes | ${magic === '%PDF-' ? 'PDF válido ✓' : 'INVÁLIDO'}`
}

async function main() {
    const login = await (
        await fetch(`${BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }),
        })
    ).json()
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }

    console.log(await pdf('inventario', H))
    console.log(await pdf('materiales', H))
    console.log(await pdf('proveedores', H))
    console.log(await pdf('ordenes', H))

    const eqs = await (await fetch(`${BASE}/equipos`, { headers: H })).json()
    const tr = eqs.find((e: any) => e.nombre === 'Trituradora TR-500')
    console.log(await pdf(`equipo/${tr._id}`, H))

    // Cotización: crear una y declarar salida para tener una 'surtida'
    const c = await (
        await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: H, body: JSON.stringify({ equipo: tr._id, contexto: 'creacion' }) })
    ).json()
    // reporte antes de surtir -> debe dar 409
    console.log('cotización (activa): ' + (await pdf(`cotizacion/${c.id}`, H)))
    // declarar salida (si todo completo)
    const salida = await (await fetch(`${BASE}/cotizaciones/${c.id}/salida`, { method: 'POST', headers: H })).json()
    console.log('declarar salida:', salida.mensaje ?? salida.error)
    console.log('cotización (surtida): ' + (await pdf(`cotizacion/${c.id}`, H)))
}

main().catch((e) => console.error(e))

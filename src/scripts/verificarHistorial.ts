// Verifica el historial de cambios: editar un componente genera un registro con antes→ahora y equipos afectados.
// Uso: npx ts-node src/scripts/verificarHistorial.ts
export {}
const BASE = 'http://localhost:4000/api'

async function main() {
    const login = await (
        await fetch(`${BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }),
        })
    ).json()
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }

    const comps = await (await fetch(`${BASE}/componentes`, { headers: H })).json()
    const comp = comps.find((c: any) => c.concepto === 'Tablero de control') ?? comps[0]
    if (!comp) return console.log('No hay componentes')
    const full = await (await fetch(`${BASE}/componentes/${comp._id}`, { headers: H })).json()
    const mat = full.variaciones[0].materiales[0]
    console.log(`Editando "${full.concepto}" / ${full.variaciones[0].nombre}: ${mat.clave} costoMXN ${mat.costoMXN} y tipo ${mat.tipo}`)

    // Cambiar costo y categoría del primer material
    mat.costoMXN = mat.costoMXN + 100
    mat.tipo = mat.tipo === 'D' ? 'C' : 'D'
    await fetch(`${BASE}/componentes/${comp._id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ variaciones: full.variaciones }),
    })

    // Leer historial
    const hist = await (await fetch(`${BASE}/historial`, { headers: H })).json()
    console.log(`\nHistorial (${hist.length} registros):`)
    hist.forEach((h: any) => {
        console.log(`\n [${new Date(h.createdAt).toLocaleString('es-MX')}] ${h.usuario} · ${h.componenteConcepto}${h.sensible ? ' (MAYOR)' : ''}`)
        console.log(`   Equipos afectados: ${h.equiposAfectados.map((e: any) => e.nombre).join(', ') || '(ninguno)'}`)
        h.cambios.forEach((c: string) => console.log(`   - ${c}`))
    })
}

main().catch((e) => console.error(e))

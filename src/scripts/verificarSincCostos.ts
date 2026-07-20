// Verifica la sincronización bidireccional de costos catálogo <-> componentes.
// Uso: npx ts-node src/scripts/verificarSincCostos.ts
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

    const mats = await (await fetch(`${BASE}/materiales`, { headers: H })).json()
    const el = mats.find((m: any) => m.clave === 'EL0001')
    const comps = await (await fetch(`${BASE}/componentes`, { headers: H })).json()
    const tab = comps.find((c: any) => c.concepto === 'Tablero de control')

    const enComp = async () => {
        const c = await (await fetch(`${BASE}/componentes/${tab._id}`, { headers: H })).json()
        const m = c.variaciones[0].materiales.find((x: any) => x.clave === 'EL0001')
        return m
    }
    const enCat = async () => (await (await fetch(`${BASE}/materiales/${el._id}`, { headers: H })).json())

    console.log('=== 1) Editar CATÁLOGO -> debe propagar al componente ===')
    await fetch(`${BASE}/materiales/${el._id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ costoUnitario: 1111, costoUSD: 61 }),
    })
    let m = await enComp()
    console.log(`  Catálogo EL0001 = 1111/61  ->  Componente EL0001: costoMXN=${m.costoMXN} costoUSD=${m.costoUSD} importeMXN=${m.importeMXN} (cant ${m.cantidad})`)

    console.log('=== 2) Editar desde el COMPONENTE -> debe emparejar el catálogo ===')
    const c = await (await fetch(`${BASE}/componentes/${tab._id}`, { headers: H })).json()
    c.variaciones[0].materiales.find((x: any) => x.clave === 'EL0001').costoMXN = 850
    c.variaciones[0].materiales.find((x: any) => x.clave === 'EL0001').costoUSD = 47
    await fetch(`${BASE}/componentes/${tab._id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ variaciones: c.variaciones }),
    })
    const cat = await enCat()
    m = await enComp()
    console.log(`  Componente EL0001 = 850/47  ->  Catálogo EL0001: costoUnitario=${cat.costoUnitario} costoUSD=${cat.costoUSD} importeMXN=${cat.importeMXN} importeUSD=${cat.importeUSD}`)
    console.log(`  Componente reconfirmado: costoMXN=${m.costoMXN} importeMXN=${m.importeMXN}`)
}

main().catch((e) => console.error(e))

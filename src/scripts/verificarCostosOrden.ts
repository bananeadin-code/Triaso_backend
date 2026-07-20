// Verifica: editar costo en una orden + propagación global (o especial) + herencia de contexto en recomendaciones.
// Uso: npx ts-node src/scripts/verificarCostosOrden.ts
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
    const prov = (await (await fetch(`${BASE}/proveedores`, { headers: H })).json()).find((p: any) => p.codigo === 'ELECMX')

    // Fijar catálogo EL0001 = 850
    await fetch(`${BASE}/materiales/${el._id}`, { method: 'PUT', headers: H, body: JSON.stringify({ costoUnitario: 850, costoUSD: el.costoUSD }) })
    const catBase = await (await fetch(`${BASE}/materiales/${el._id}`, { headers: H })).json()
    console.log(`Catálogo EL0001 base: ${catBase.costoUnitario}`)

    // 1) Crear orden con costo ESPECIAL (930) SIN propagar
    const c1 = await (
        await fetch(`${BASE}/ordenes`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({ proveedor: prov._id, items: [{ material: el._id, cantidad: 2, costoUnitario: 930 }] }),
        })
    ).json()
    let cat = await (await fetch(`${BASE}/materiales/${el._id}`, { headers: H })).json()
    const o1 = await (await fetch(`${BASE}/ordenes/${c1.id}`, { headers: H })).json()
    console.log(`\n1) Orden ${c1.folio} costo especial 930 (sin propagar): item=${o1.items[0].costoUnitario} | Catálogo sigue=${cat.costoUnitario} (debe 850)`)

    // 2) Editar la orden con costo 1000 y PROPAGAR global
    await fetch(`${BASE}/ordenes/${c1.id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ items: [{ material: el._id, cantidad: 2, costoUnitario: 1000 }], materialesGlobal: [el._id] }),
    })
    cat = await (await fetch(`${BASE}/materiales/${el._id}`, { headers: H })).json()
    const comps = await (await fetch(`${BASE}/componentes`, { headers: H })).json()
    const tab = comps.find((x: any) => x.concepto === 'Tablero de control')
    const compFull = await (await fetch(`${BASE}/componentes/${tab._id}`, { headers: H })).json()
    const mEnComp = compFull.variaciones[0].materiales.find((m: any) => m.clave === 'EL0001')
    console.log(`2) Editar orden costo 1000 + PROPAGAR global -> Catálogo EL0001=${cat.costoUnitario} (debe 1000) | Componente EL0001 costoMXN=${mEnComp?.costoMXN} (debe 1000)`)

    // limpieza
    await fetch(`${BASE}/ordenes/${c1.id}`, { method: 'DELETE', headers: H })
}

main().catch((e) => console.error(e))

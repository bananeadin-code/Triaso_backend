// Verifica que el costo USD viaje con el mismo ritmo que el MXN en todos los puntos
// donde el costo es editable: órdenes, propagación global, cotización (costo real) y edición inline.
// Uso: npx ts-node src/scripts/verificarUSD.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(
        await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) })
    )
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    const mats = await j(await fetch(`${BASE}/materiales`, { headers: A }))
    const el = mats.find((m: any) => m.clave === 'EL0001')
    const provs = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    const prov = provs.find((p: any) => p.codigo === 'ELECMX') ?? provs[0]

    // Base conocida
    await fetch(`${BASE}/materiales/${el._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ costoUnitario: 1000, costoUSD: 50 }) })
    console.log('Catálogo base: MXN 1000 / USD 50')

    // ===== 1) La orden guarda AMBOS costos =====
    console.log('\n=== 1) ORDEN CON AMBAS MONEDAS ===')
    const oc = await j(
        await fetch(`${BASE}/ordenes`, {
            method: 'POST',
            headers: A,
            body: JSON.stringify({ proveedor: prov._id, items: [{ material: el._id, cantidad: 3, costoUnitario: 1200, costoUnitarioUSD: 62 }] }),
        })
    )
    let full = await j(await fetch(`${BASE}/ordenes/${oc.id}`, { headers: A }))
    let it = full.items[0]
    console.log(`items -> MXN ${it.costoUnitario} (imp ${it.importe}) | USD ${it.costoUnitarioUSD} (imp ${it.importeUSD})`)
    console.log('Guarda ambos e importes correctos:', ok(it.costoUnitarioUSD === 62 && it.importeUSD === 186 && it.importe === 3600))

    // Costo ESPECIAL: no debe tocar el catálogo en ninguna moneda
    let cat = await j(await fetch(`${BASE}/materiales/${el._id}`, { headers: A }))
    console.log('Catálogo intacto tras costo especial:', ok(cat.costoUnitario === 1000 && cat.costoUSD === 50))

    // ===== 2) Propagación GLOBAL actualiza ambas =====
    console.log('\n=== 2) ACTUALIZAR EN TODO EL SISTEMA ===')
    await fetch(`${BASE}/ordenes/${oc.id}`, {
        method: 'PUT',
        headers: A,
        body: JSON.stringify({ items: [{ material: el._id, cantidad: 3, costoUnitario: 1300, costoUnitarioUSD: 68 }], materialesGlobal: [el._id] }),
    })
    cat = await j(await fetch(`${BASE}/materiales/${el._id}`, { headers: A }))
    console.log(`Catálogo -> MXN ${cat.costoUnitario} / USD ${cat.costoUSD}`)
    console.log('Ambas monedas propagadas:', ok(cat.costoUnitario === 1300 && cat.costoUSD === 68))

    // Y a los componentes que usan el material
    const comps = await j(await fetch(`${BASE}/componentes`, { headers: A }))
    const tab = comps.find((c: any) => c.concepto === 'Tablero de control')
    if (tab) {
        const compFull = await j(await fetch(`${BASE}/componentes/${tab._id}`, { headers: A }))
        const mEnComp = compFull.variaciones.flatMap((v: any) => v.materiales).find((m: any) => m.clave === 'EL0001')
        console.log(`Componente -> MXN ${mEnComp?.costoMXN} / USD ${mEnComp?.costoUSD}`)
        console.log('Componente sincronizado en ambas:', ok(mEnComp?.costoMXN === 1300 && mEnComp?.costoUSD === 68))
    }

    // El historial registra ambos cambios
    const hist = await j(await fetch(`${BASE}/historial`, { headers: A }))
    const cambios = hist[0]?.cambios ?? []
    console.log('Historial registra MXN y USD:', ok(cambios.some((c: string) => c.includes('MXN')) && cambios.some((c: string) => c.includes('USD'))))
    cambios.forEach((c: string) => console.log('   ·', c))

    // ===== 3) Costo real de la cotización en ambas monedas =====
    console.log('\n=== 3) COSTO REAL DE COTIZACIÓN ===')
    const eq = (await j(await fetch(`${BASE}/equipos`, { headers: A }))).find((e: any) => e.nombre.includes('TR-500'))
    const cot = await j(await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: A, body: JSON.stringify({ equipo: eq._id, contexto: 'creacion' }) }))
    // Liga la orden a la cotización registrándola desde ahí no aplica aquí; probamos vía catálogo
    let d = await j(await fetch(`${BASE}/cotizaciones/${cot.id}`, { headers: A }))
    const fila = d.lineasTabla.flatMap((l: any) => l.materiales).find((m: any) => m.clave === 'EL0001')
    console.log(`EL0001 -> costoRealMXN ${fila.costoRealMXN} / costoRealUSD ${fila.costoRealUSD} | importes ${fila.importeRealMXN} / ${fila.importeRealUSD}`)
    console.log('Trae ambas monedas:', ok(fila.costoRealUSD === 68 && fila.importeRealUSD === +(68 * fila.cantidad).toFixed(2)))
    console.log(`totalReal ${d.totalReal} / totalRealUSD ${d.totalRealUSD}`, ok(d.totalRealUSD > 0))

    // ===== 4) Edición inline desde la cotización (solo USD) =====
    console.log('\n=== 4) EDICIÓN INLINE (solo USD, el MXN se conserva) ===')
    await fetch(`${BASE}/cotizaciones/${cot.id}/costo-material`, { method: 'PUT', headers: A, body: JSON.stringify({ material: el._id, costoUSD: 77 }) })
    cat = await j(await fetch(`${BASE}/materiales/${el._id}`, { headers: A }))
    console.log(`Catálogo -> MXN ${cat.costoUnitario} / USD ${cat.costoUSD}`)
    console.log('USD actualizado y MXN intacto:', ok(cat.costoUSD === 77 && cat.costoUnitario === 1300))

    // Limpieza
    await fetch(`${BASE}/cotizaciones/${cot.id}`, { method: 'DELETE', headers: A })
    await fetch(`${BASE}/ordenes/${oc.id}`, { method: 'DELETE', headers: A })
    await fetch(`${BASE}/materiales/${el._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ costoUnitario: 1100, costoUSD: 49 }) })
    console.log('\n(limpieza hecha; EL0001 restaurado a MXN 1100 / USD 49)')
}

main().catch((e) => console.error(e))

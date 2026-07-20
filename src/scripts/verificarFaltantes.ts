// Verifica faltantes -> recomendaciones -> finalizar.
// Uso: npx ts-node src/scripts/verificarFaltantes.ts
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

    // Buscar una orden enviada que tenga EL0001
    const ordenes = await (await fetch(`${BASE}/ordenes`, { headers: H })).json()
    let target: any = null
    for (const o of ordenes.filter((x: any) => x.estado === 'enviada')) {
        const full = await (await fetch(`${BASE}/ordenes/${o._id}`, { headers: H })).json()
        if (full.items.some((i: any) => i.clave === 'EL0001')) {
            target = full
            break
        }
    }
    if (!target) {
        console.log('No hay orden enviada con EL0001. Órdenes:', ordenes.map((o: any) => `${o.folio}:${o.estado}`))
        return
    }
    const el = target.items.find((i: any) => i.clave === 'EL0001')
    console.log(`Orden ${target.folio} | items: ${target.items.map((i: any) => i.clave + 'x' + i.cantidad).join(', ')} | total=${target.presupuestoEstimado}`)

    // Marcar EL0001 completo como faltante
    const falt = await (
        await fetch(`${BASE}/ordenes/${target._id}/faltantes`, {
            method: 'PUT',
            headers: H,
            body: JSON.stringify({ faltantes: [{ material: el.material, cantidad: el.cantidad }] }),
        })
    ).json()
    console.log(`\nFaltantes -> ${falt.mensaje} | recomendaciones=${falt.recomendacionesGeneradas} | sinAlternativa=[${falt.sinAlternativa}] | nuevoTotal=${falt.nuevoTotal}`)

    // Orden tras faltantes
    const o2 = await (await fetch(`${BASE}/ordenes/${target._id}`, { headers: H })).json()
    console.log(`Orden ahora | items: ${o2.items.map((i: any) => i.clave + 'x' + i.cantidad).join(', ') || '(vacía)'} | total=${o2.presupuestoEstimado} | faltantes: ${o2.faltantes.map((f: any) => f.clave + 'x' + f.cantidad).join(', ')}`)

    // Recomendaciones pendientes
    const recs = await (await fetch(`${BASE}/recomendaciones`, { headers: H })).json()
    console.log(`\nRecomendaciones pendientes: ${recs.length}`)
    recs.forEach((r: any) =>
        console.log(`   -> ${r.proveedorSnap.codigo} (de ${r.folioOrigen}): ${r.items.map((i: any) => i.clave + 'x' + i.cantidad).join(', ')}`)
    )

    // Finalizar la primera recomendación (crea orden nueva)
    if (recs.length > 0) {
        const fin = await (
            await fetch(`${BASE}/recomendaciones/${recs[0]._id}/finalizar`, { method: 'POST', headers: H })
        ).json()
        console.log(`\nFinalizar recomendación -> ${fin.mensaje} | nueva orden ${fin.folio}`)
        const recs2 = await (await fetch(`${BASE}/recomendaciones`, { headers: H })).json()
        console.log(`Recomendaciones pendientes ahora: ${recs2.length}`)
    }
}

main().catch((e) => console.error(e))

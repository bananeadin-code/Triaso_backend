// Verifica confirmar recepción -> estado confirmada + costo real + stock al inventario.
// Uso: npx ts-node src/scripts/verificarRecepcion.ts
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

    const ordenes = await (await fetch(`${BASE}/ordenes`, { headers: H })).json()
    const enviada = ordenes.find((o: any) => o.estado === 'enviada')
    if (!enviada) {
        console.log('No hay orden enviada. Órdenes:', ordenes.map((o: any) => `${o.folio}:${o.estado}`))
        return
    }
    const full = await (await fetch(`${BASE}/ordenes/${enviada._id}`, { headers: H })).json()
    console.log(`Orden ${full.folio} | items: ${full.items.map((i: any) => i.clave + 'x' + i.cantidad).join(', ')} | estimado=${full.presupuestoEstimado}`)

    // Inventario ANTES
    const invAntes = await (await fetch(`${BASE}/inventario`, { headers: H })).json()
    const stockAntes: Record<string, number> = {}
    invAntes.forEach((i: any) => (stockAntes[i.material?.clave] = i.cantidad))
    console.log('Stock ANTES:', JSON.stringify(stockAntes))

    // Confirmar recepción (recibe todo, costo real 5000)
    const conf = await (
        await fetch(`${BASE}/ordenes/${enviada._id}/confirmar`, {
            method: 'PUT',
            headers: H,
            body: JSON.stringify({
                items: full.items.map((i: any) => ({ material: i.material, cantidad: i.cantidad })),
                costoRealTotal: 5000,
            }),
        })
    ).json()
    console.log(`\nConfirmar -> ${conf.mensaje} | costoReal=${conf.costoRealTotal} | materialesEnStock=${conf.materialesEnStock}`)

    // Orden tras confirmar
    const o2 = await (await fetch(`${BASE}/ordenes/${enviada._id}`, { headers: H })).json()
    console.log(`Estado ahora: ${o2.estado} | costoRealTotal=${o2.costoRealTotal} | confirmadaAt=${o2.confirmadaAt ? 'sí' : 'no'}`)

    // Inventario DESPUÉS
    const invDespues = await (await fetch(`${BASE}/inventario`, { headers: H })).json()
    const stockDespues: Record<string, number> = {}
    invDespues.forEach((i: any) => (stockDespues[i.material?.clave] = i.cantidad))
    console.log('Stock DESPUÉS:', JSON.stringify(stockDespues))

    // Diferencias
    full.items.forEach((it: any) => {
        const antes = stockAntes[it.clave] ?? 0
        const despues = stockDespues[it.clave] ?? 0
        console.log(`   ${it.clave}: ${antes} -> ${despues} (recibido ${it.cantidad}, delta ${despues - antes})`)
    })
}

main().catch((e) => console.error(e))

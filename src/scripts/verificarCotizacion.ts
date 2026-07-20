// Verifica el flujo de cotización: crear → detalle (stock vs faltantes) → órdenes sugeridas → registrar → cancelar.
// Uso: npx ts-node src/scripts/verificarCotizacion.ts
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

    // Ajustar stock de EL0001 a 1 para provocar faltante (guardamos el valor previo)
    const inv = await (await fetch(`${BASE}/inventario`, { headers: H })).json()
    const el = inv.find((i: any) => i.material?.clave === 'EL0001')
    const stockPrevio = el?.cantidad
    if (el) await fetch(`${BASE}/inventario/${el._id}`, { method: 'PUT', headers: H, body: JSON.stringify({ cantidad: 1 }) })
    console.log(`Stock EL0001: ${stockPrevio} -> 1 (para provocar faltante)`)

    // Equipo TR-500
    const equipos = await (await fetch(`${BASE}/equipos`, { headers: H })).json()
    const tr = equipos.find((e: any) => e.nombre === 'Trituradora TR-500')

    // Crear cotización (creación)
    const crear = await (
        await fetch(`${BASE}/cotizaciones`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({ equipo: tr._id, contexto: 'creacion' }),
        })
    ).json()
    console.log(`\nCotización creada: ${crear.folio} (id ${crear.id})`)

    // Detalle
    const det = await (await fetch(`${BASE}/cotizaciones/${crear.id}`, { headers: H })).json()
    console.log(`Costo cotización: $${det.costoCotizacion} | contexto=${det.contexto}`)
    console.log('\nTabla (material | requerido | stock | estado):')
    for (const l of det.lineasTabla) {
        console.log(`  Componente ${l.componenteConcepto} (${l.variacionNombre}) x${l.cantidad}`)
        for (const m of l.materiales) {
            const info =
                m.estadoStock === 'completo'
                    ? '✓ completo'
                    : m.estadoStock === 'requerido'
                      ? 'REQUERIDO'
                      : `faltan ${m.faltante}`
            console.log(`     ${m.clave} ${m.concepto} | req ${m.cantidad} | stock ${m.stock} | ${info}`)
        }
    }
    console.log('\nÓrdenes sugeridas:')
    for (const o of det.ordenesSugeridas) {
        console.log(`  → ${o.codigo} (${o.razonSocial}) total $${o.total}: ${o.items.map((i: any) => i.clave + 'x' + i.cantidad).join(', ')}`)
    }

    // Registrar todas las órdenes como borrador
    const reg = await (await fetch(`${BASE}/cotizaciones/${crear.id}/ordenes`, { method: 'POST', headers: H })).json()
    console.log(`\nRegistrar órdenes -> ${reg.mensaje}: ${reg.ordenes.join(', ')}`)

    // Verificar que la orden tiene el folio de cotización
    const ordenes = await (await fetch(`${BASE}/ordenes`, { headers: H })).json()
    const deCot = ordenes.filter((o: any) => o.folio && reg.ordenes.includes(o.folio))
    const full = await (await fetch(`${BASE}/ordenes/${(await (await fetch(`${BASE}/ordenes`, { headers: H })).json()).find((o: any) => reg.ordenes.includes(o.folio))._id}`, { headers: H })).json()
    console.log(`Orden ${full.folio} folioCotizacion=${full.folioCotizacion} estado=${full.estado}`)

    // Cancelar cotización (debe borrar la orden borrador)
    const canc = await (await fetch(`${BASE}/cotizaciones/${crear.id}`, { method: 'DELETE', headers: H })).json()
    console.log(`\nCancelar -> ${canc.mensaje} | órdenes eliminadas: ${canc.ordenesEliminadas}`)

    // Restaurar stock
    if (el && stockPrevio !== undefined) await fetch(`${BASE}/inventario/${el._id}`, { method: 'PUT', headers: H, body: JSON.stringify({ cantidad: stockPrevio }) })
    console.log(`Stock EL0001 restaurado a ${stockPrevio}`)
    void deCot
}

main().catch((e) => console.error(e))

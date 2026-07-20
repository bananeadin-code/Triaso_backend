// Verifica que una orden CONFIRMADA/CANCELADA no bloquee re-sugerir/registrar una nueva
// orden para un material que SIGUE faltante (bug: la tarjeta salía "Registrada" y no dejaba).
// Uso: npx ts-node src/scripts/verificarReordenFaltante.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()

async function setInv(H: any, materialId: string, cantidad: number) {
    const r = await fetch(`${BASE}/inventario`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ material: materialId, cantidad, ubicacion: 'TEST' }),
    })
    if (r.status === 409) {
        const inv = await j(await fetch(`${BASE}/inventario`, { headers: H }))
        const it = inv.find((i: any) => i.material && String(i.material._id) === String(materialId))
        if (it) await fetch(`${BASE}/inventario/${it._id}`, { method: 'PUT', headers: H, body: JSON.stringify({ cantidad }) })
    }
}

async function main() {
    const login = await j(
        await fetch(`${BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }),
        })
    )
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }

    const equipos = await j(await fetch(`${BASE}/equipos`, { headers: H }))
    const tr = equipos.find((e: any) => (e.nombre || '').includes('TR-500')) || equipos[0]
    const mats = await j(await fetch(`${BASE}/materiales`, { headers: H }))
    const el2 = mats.find((m: any) => m.clave === 'EL0002')

    // Cotización de creación
    const cot = await j(
        await fetch(`${BASE}/cotizaciones`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({ equipo: tr._id, contexto: 'creacion' }),
        })
    )
    const cotId = cot.id
    console.log('Cotización:', cot.folio)

    // Solo EL0002 faltante: resto de sus materiales en stock alto, EL0002 = 0
    let d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    const ids = [...new Set(d.lineasTabla.flatMap((l: any) => l.materiales.map((m: any) => m.material)).filter(Boolean))] as string[]
    for (const mid of ids) await setInv(H, mid, mid === String(el2._id) ? 0 : 500)

    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    console.log('Órdenes sugeridas:', d.ordenesSugeridas.map((o: any) => `${o.codigo}[${o.items.map((i: any) => i.clave).join(',')}]`).join(' '))
    const sug = d.ordenesSugeridas.find((o: any) => o.items.some((i: any) => i.clave === 'EL0002'))

    // Registrar la orden sugerida (borrador) → enviar → confirmar SIN recibir EL0002 (queda faltante)
    await fetch(`${BASE}/cotizaciones/${cotId}/ordenes`, { method: 'POST', headers: H, body: JSON.stringify({ proveedor: sug.proveedor }) })
    let ordenes = await j(await fetch(`${BASE}/ordenes`, { headers: H }))
    const oc = ordenes.find((o: any) => o.folioCotizacion === cot.folio && o.estado === 'borrador')
    console.log('Orden registrada:', oc.folio, '(borrador)')
    await fetch(`${BASE}/ordenes/${oc._id}/enviar`, { method: 'PUT', headers: H, body: JSON.stringify({ enviarCorreo: false }) })
    await fetch(`${BASE}/ordenes/${oc._id}/confirmar`, { method: 'PUT', headers: H, body: JSON.stringify({ items: [{ material: el2._id, cantidad: 0 }], costoRealTotal: 0 }) })
    const ocConf = await j(await fetch(`${BASE}/ordenes/${oc._id}`, { headers: H }))
    console.log('Orden', oc.folio, '→ estado', ocConf.estado, '(confirmada, EL0002 NO recibido)')

    // Detalle: EL0002 sigue faltante, y la orden previa está confirmada (no pendiente)
    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    const el2row = d.lineasTabla.flatMap((l: any) => l.materiales).find((m: any) => m.clave === 'EL0002')
    const regsElecmx = d.ordenesRegistradas.filter((r: any) => r.proveedorSnap.codigo === sug.codigo)
    const pendiente = regsElecmx.find((r: any) => r.estado === 'borrador' || r.estado === 'enviada')
    console.log('EL0002 estadoStock:', el2row?.estadoStock, '| órdenes', sug.codigo, ':', regsElecmx.map((r: any) => `${r.folio}:${r.estado}`).join(', '), '| ¿pendiente?', !!pendiente, '(debe false → tarjeta NO "Registrada")')

    // Registrar de nuevo → DEBE crear una nueva orden (antes se saltaba)
    const rReg = await j(await fetch(`${BASE}/cotizaciones/${cotId}/ordenes`, { method: 'POST', headers: H, body: JSON.stringify({ proveedor: sug.proveedor }) }))
    console.log('Re-registrar orden →', JSON.stringify(rReg.ordenes), '(DEBE crear 1 nueva)')

    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    console.log('Órdenes de la cotización ahora:', d.ordenesRegistradas.map((r: any) => `${r.folio}:${r.estado}`).join(', '))

    // Limpieza
    await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'DELETE', headers: H })
    console.log('\nLimpieza: cotización', cot.folio, 'cancelada (borra borradores; conserva la confirmada).')
}

main().catch((e) => console.error(e))

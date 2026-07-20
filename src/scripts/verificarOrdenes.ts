// Verifica el backend de Órdenes de Compra (crear con snapshots + total estimado, editar, listar).
// Uso: npx ts-node src/scripts/verificarOrdenes.ts
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

    const proveedores = await (await fetch(`${BASE}/proveedores`, { headers: H })).json()
    const elecmx = proveedores.find((p: any) => p.codigo === 'ELECMX')

    // materiales asociados al proveedor
    const detalle = await (await fetch(`${BASE}/proveedores/${elecmx._id}`, { headers: H })).json()
    console.log(`Proveedor ${elecmx.codigo}: ${detalle.materiales.length} materiales asociados`)
    detalle.materiales.forEach((m: any) =>
        console.log(`   ${m.clave} ${m.concepto} costoUnit=${m.costoUnitario}`)
    )

    const [m1, m2] = detalle.materiales

    // crear orden (sin costoUnitario -> lo toma del catálogo)
    const crear = await (
        await fetch(`${BASE}/ordenes`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({
                proveedor: elecmx._id,
                items: [
                    { material: m1._id, cantidad: 4 },
                    { material: m2._id, cantidad: 10 },
                ],
            }),
        })
    ).json()
    console.log(`\nOrden creada: folio=${crear.folio} id=${crear.id}`)

    const orden = await (await fetch(`${BASE}/ordenes/${crear.id}`, { headers: H })).json()
    console.log(`Estado: ${orden.estado} | proveedorSnap: ${orden.proveedorSnap.codigo}/${orden.proveedorSnap.razonSocial} RFC=${orden.proveedorSnap.rfc || '-'}`)
    orden.items.forEach((i: any) =>
        console.log(`   ${i.clave} ${i.concepto} | ${i.cantidad} x ${i.costoUnitario} = ${i.importe}`)
    )
    console.log(`Presupuesto estimado (auto = suma importes): ${orden.presupuestoEstimado}`)

    // editar total estimado manual
    await fetch(`${BASE}/ordenes/${crear.id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ presupuestoEstimado: 5000 }),
    })
    const orden2 = await (await fetch(`${BASE}/ordenes/${crear.id}`, { headers: H })).json()
    console.log(`Presupuesto tras editar manual: ${orden2.presupuestoEstimado}`)

    // listado
    const lista = await (await fetch(`${BASE}/ordenes`, { headers: H })).json()
    console.log(`\nÓrdenes (${lista.length}):`)
    lista.forEach((o: any) =>
        console.log(`   ${o.folio} | ${o.proveedor} | ${o.estado} | items=${o.totalItems} | est=${o.presupuestoEstimado}`)
    )

    // limpieza
    await fetch(`${BASE}/ordenes/${crear.id}`, { method: 'DELETE', headers: H })
    console.log('(orden de prueba eliminada)')
}

main().catch((e) => console.error(e))

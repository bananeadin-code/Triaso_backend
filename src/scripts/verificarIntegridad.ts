// Verifica el bloque de integridad: guardas de borrado, cancelación de órdenes
// y bloqueo de cancelar cotizaciones surtidas.
// Uso: npx ts-node src/scripts/verificarIntegridad.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const a = await j(
        await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) })
    )
    const A = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }

    // ===== 1) GUARDAS DE BORRADO =====
    console.log('=== 1) BORRADOS PROTEGIDOS ===')
    const mats = await j(await fetch(`${BASE}/materiales`, { headers: A }))
    const enUso = mats.find((m: any) => m.clave === 'EL0001')
    let r = await fetch(`${BASE}/materiales/${enUso._id}`, { method: 'DELETE', headers: A })
    let cuerpo = await r.json()
    console.log(`Material en uso -> ${r.status}`, ok(r.status === 409))
    console.log(`   "${cuerpo.error}"`)

    const comps = await j(await fetch(`${BASE}/componentes`, { headers: A }))
    const compEnUso = comps.find((c: any) => c.concepto === 'Tablero de control') ?? comps[0]
    r = await fetch(`${BASE}/componentes/${compEnUso._id}`, { method: 'DELETE', headers: A })
    cuerpo = await r.json()
    console.log(`Componente en BOM -> ${r.status}`, ok(r.status === 409))
    console.log(`   "${cuerpo.error}"`)

    const provs = await j(await fetch(`${BASE}/proveedores`, { headers: A }))
    r = await fetch(`${BASE}/proveedores/${provs[0]._id}`, { method: 'DELETE', headers: A })
    cuerpo = await r.json()
    console.log(`Proveedor en uso -> ${r.status}`, ok(r.status === 409))
    console.log(`   "${cuerpo.error}"`)

    // Un material NUEVO sin usar SÍ se puede borrar
    const nuevo = await j(
        await fetch(`${BASE}/materiales`, {
            method: 'POST',
            headers: A,
            body: JSON.stringify({ concepto: 'Material temporal QA', categoriaPrincipal: 'B', proveedorPrincipal: provs[0]._id, costoUnitario: 10, costoUSD: 1 }),
        })
    )
    r = await fetch(`${BASE}/materiales/${nuevo.id}`, { method: 'DELETE', headers: A })
    console.log(`Material SIN usar -> ${r.status}`, ok(r.status === 200), '(debe permitirse)')

    // ===== 2) CANCELAR ORDEN =====
    console.log('\n=== 2) CANCELAR ORDEN (estado antes muerto) ===')
    const prov = provs.find((p: any) => p.codigo === 'ELECMX') ?? provs[0]
    const oc = await j(
        await fetch(`${BASE}/ordenes`, { method: 'POST', headers: A, body: JSON.stringify({ proveedor: prov._id, items: [{ material: enUso._id, cantidad: 1, costoUnitario: 100 }] }) })
    )
    await fetch(`${BASE}/ordenes/${oc.id}/enviar`, { method: 'PUT', headers: A, body: JSON.stringify({ enviarCorreo: false }) })
    r = await fetch(`${BASE}/ordenes/${oc.id}/cancelar`, { method: 'PUT', headers: A, body: JSON.stringify({ motivo: 'El proveedor no tiene existencias' }) })
    console.log(`Cancelar orden enviada -> ${r.status}`, ok(r.status === 200))
    let ordenFull = await j(await fetch(`${BASE}/ordenes/${oc.id}`, { headers: A }))
    console.log(`   estado=${ordenFull.estado}`, ok(ordenFull.estado === 'cancelada'), `| notas: "${ordenFull.notas}"`)
    r = await fetch(`${BASE}/ordenes/${oc.id}/cancelar`, { method: 'PUT', headers: A })
    console.log(`Cancelar dos veces -> ${r.status}`, ok(r.status === 409))

    // Una confirmada NO se puede cancelar
    const oc2 = await j(
        await fetch(`${BASE}/ordenes`, { method: 'POST', headers: A, body: JSON.stringify({ proveedor: prov._id, items: [{ material: enUso._id, cantidad: 1, costoUnitario: 100 }] }) })
    )
    await fetch(`${BASE}/ordenes/${oc2.id}/enviar`, { method: 'PUT', headers: A, body: JSON.stringify({ enviarCorreo: false }) })
    await fetch(`${BASE}/ordenes/${oc2.id}/confirmar`, { method: 'PUT', headers: A, body: JSON.stringify({ items: [] }) })
    r = await fetch(`${BASE}/ordenes/${oc2.id}/cancelar`, { method: 'PUT', headers: A })
    console.log(`Cancelar orden CONFIRMADA -> ${r.status}`, ok(r.status === 409))

    // ===== 3) COTIZACIÓN SURTIDA NO SE CANCELA =====
    console.log('\n=== 3) COTIZACIÓN SURTIDA ===')
    const cots = await j(await fetch(`${BASE}/cotizaciones`, { headers: A }))
    const surtida = cots.find((c: any) => c.estado === 'surtida')
    if (surtida) {
        r = await fetch(`${BASE}/cotizaciones/${surtida._id}`, { method: 'DELETE', headers: A })
        cuerpo = await r.json()
        console.log(`Cancelar cotización surtida -> ${r.status}`, ok(r.status === 409))
        console.log(`   "${cuerpo.error}"`)
    } else {
        console.log('(no hay cotización surtida para probar)')
    }

    // Limpieza: borrar las órdenes de prueba
    await fetch(`${BASE}/ordenes/${oc.id}`, { method: 'DELETE', headers: A })
    console.log('\n(orden cancelada de prueba eliminada; la confirmada se conserva por diseño)')
}

main().catch((e) => console.error(e))

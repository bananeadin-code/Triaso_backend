// Verifica las nuevas fuentes de historial y el bloqueo del cotizador sobre la composición.
// Uso: npx ts-node src/scripts/verificarHistorialAmpliado.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function login(email: string, password: string) {
    const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    if (r.status !== 200) return null
    const { token } = await r.json()
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}
const ultimo = async (H: any) => (await j(await fetch(`${BASE}/historial`, { headers: H })))[0]

async function main() {
    const A = (await login('admin@triaso.com', 'admin123'))!

    // ===== 1) Editar costo desde el CATÁLOGO =====
    console.log('=== 1) COSTO DESDE EL CATÁLOGO ===')
    const mats = await j(await fetch(`${BASE}/materiales`, { headers: A }))
    const el = mats.find((m: any) => m.clave === 'EL0001')
    const costoOrig = el.costoUnitario
    await fetch(`${BASE}/materiales/${el._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ costoUnitario: costoOrig + 55, costoUSD: el.costoUSD }) })
    let h = await ultimo(A)
    console.log('tipo:', h.tipo, '| material:', h.materialClave, '| usuario:', h.usuario)
    console.log('cambio:', h.cambios[0])
    console.log('Registró desde catálogo:', ok(h.tipo === 'material' && h.cambios[0].includes('Costo MXN')))

    // Cambio de categoría => sensible
    await fetch(`${BASE}/materiales/${el._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ categoriaPrincipal: 'A', costoUnitario: costoOrig, costoUSD: el.costoUSD }) })
    h = await ultimo(A)
    console.log('Cambio de categoría marcado sensible:', ok(h.sensible === true), '|', h.cambios.join(' / '))
    await fetch(`${BASE}/materiales/${el._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ categoriaPrincipal: el.categoriaPrincipal, costoUnitario: costoOrig, costoUSD: el.costoUSD }) })

    // ===== 2) Costo actualizado GLOBALMENTE desde una orden =====
    console.log('\n=== 2) COSTO GLOBAL DESDE UNA ORDEN ===')
    const prov = (await j(await fetch(`${BASE}/proveedores`, { headers: A }))).find((p: any) => p.codigo === 'ELECMX')
    const oc = await j(await fetch(`${BASE}/ordenes`, { method: 'POST', headers: A, body: JSON.stringify({ proveedor: prov._id, items: [{ material: el._id, cantidad: 2, costoUnitario: costoOrig }] }) }))
    // (a) costo especial SIN propagar -> no debe registrar
    await fetch(`${BASE}/ordenes/${oc.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ items: [{ material: el._id, cantidad: 2, costoUnitario: costoOrig + 300 }] }) })
    const hSin = await ultimo(A)
    console.log('Costo especial (sin propagar) NO registra:', ok(!hSin.cambios[0]?.includes('actualizado en todo el sistema')))
    // (b) con materialesGlobal -> sí registra
    await fetch(`${BASE}/ordenes/${oc.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ items: [{ material: el._id, cantidad: 2, costoUnitario: costoOrig + 500 }], materialesGlobal: [el._id] }) })
    h = await ultimo(A)
    console.log('cambio:', h.cambios[0])
    console.log('Registró propagación global:', ok(h.tipo === 'material' && h.cambios[0].includes('actualizado en todo el sistema') && h.sensible === true))
    await fetch(`${BASE}/ordenes/${oc.id}`, { method: 'DELETE', headers: A })
    await fetch(`${BASE}/materiales/${el._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ costoUnitario: costoOrig, costoUSD: el.costoUSD }) })

    // ===== 3) Cotizador NO puede tocar la composición =====
    console.log('\n=== 3) COTIZADOR vs COMPOSICIÓN DE EQUIPOS ===')
    const c = await j(await fetch(`${BASE}/usuarios`, { method: 'POST', headers: A, body: JSON.stringify({ nombre: 'Cot Test', email: 't_cot2@triaso.com', password: 'clave123', rol: 'cotizador', debeCambiarPassword: false, permisos: { limpiarHistoriales: false, generarReportes: false } }) }))
    const C = (await login('t_cot2@triaso.com', 'clave123'))!
    const eq = (await j(await fetch(`${BASE}/equipos`, { headers: C })))[0]
    const perfil = await j(await fetch(`${BASE}/auth/perfil`, { headers: C }))
    console.log('acceso.equipos:', perfil.acceso.equipos, '(debe lectura)')
    const rVer = await fetch(`${BASE}/equipos/${eq._id}`, { headers: C })
    const rEdit = await fetch(`${BASE}/equipos/${eq._id}`, { method: 'PUT', headers: C, body: JSON.stringify({ lineas: [] }) })
    const rDel = await fetch(`${BASE}/equipos/${eq._id}`, { method: 'DELETE', headers: C })
    const rCrear = await fetch(`${BASE}/equipos`, { method: 'POST', headers: C, body: JSON.stringify({ nombre: 'X' }) })
    console.log('Ver BOM (para cotizar):', ok(rVer.status === 200))
    console.log('Editar composición (bloq):', ok(rEdit.status === 403))
    console.log('Eliminar equipo (bloq):   ', ok(rDel.status === 403))
    console.log('Crear equipo (bloq):      ', ok(rCrear.status === 403))
    console.log('Sigue pudiendo cotizar:   ', ok((await fetch(`${BASE}/cotizaciones`, { method: 'POST', headers: C, body: JSON.stringify({ equipo: eq._id, contexto: 'creacion' }) })).status === 201))
    await fetch(`${BASE}/usuarios/${c.id}`, { method: 'DELETE', headers: A })

    // ===== 4) Eliminar equipo => registro CRÍTICO =====
    console.log('\n=== 4) ELIMINAR EQUIPO = CRÍTICO ===')
    const nuevo = await j(await fetch(`${BASE}/equipos`, { method: 'POST', headers: A, body: JSON.stringify({ nombre: 'Equipo Desechable QA', tipo: 'Prueba' }) }))
    await fetch(`${BASE}/equipos/${nuevo.id}`, { method: 'DELETE', headers: A })
    h = await ultimo(A)
    console.log('tipo:', h.tipo, '| critico:', h.critico, '| responsable:', h.usuario)
    console.log('cambio:', h.cambios[0])
    console.log('Registro crítico de eliminación:', ok(h.tipo === 'equipo' && h.critico === true && h.usuario === 'Administrador'))
}

main().catch((e) => console.error(e))

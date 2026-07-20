// Verifica el COSTO REAL de una cotización (Bloque 2):
//  - material que vino de una orden ligada → muestra el costo de ESA orden (aunque el catálogo NO se haya actualizado)
//  - material que estaba en inventario (sin orden) → costo del catálogo, EDITABLE inline (actualiza el catálogo)
//  - totalReal = suma de los importes reales
// Uso: npx ts-node src/scripts/verificarCostoRealCot.ts
export {}
const BASE = 'http://localhost:4000/api'
const j = (r: Response) => r.json()

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
    const el = mats.find((m: any) => m.clave === 'EL0001')
    console.log('Equipo:', tr.nombre, '| EL0001 id:', el?._id)

    // Catálogo EL0001 = 850
    await fetch(`${BASE}/materiales/${el._id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ costoUnitario: 850, costoUSD: el.costoUSD }),
    })

    // EL0001 en inventario a 0 → faltante → genera orden sugerida
    const inv = await j(await fetch(`${BASE}/inventario`, { headers: H }))
    const invEl = inv.find((i: any) => i.material && i.material.clave === 'EL0001')
    if (invEl)
        await fetch(`${BASE}/inventario/${invEl._id}`, {
            method: 'PUT',
            headers: H,
            body: JSON.stringify({ cantidad: 0, ubicacion: invEl.ubicacion || '' }),
        })

    // Crear cotización de creación
    const cot = await j(
        await fetch(`${BASE}/cotizaciones`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({ equipo: tr._id, contexto: 'creacion' }),
        })
    )
    const cotId = cot.id
    console.log('\nCotización:', cot.folio)

    let d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    const filas = () => d.lineasTabla.flatMap((l: any) => l.materiales)
    console.log('totalReal inicial:', d.totalReal, '| costoCotizacion(manual):', d.costoCotizacion)
    const el0 = filas().find((m: any) => m.clave === 'EL0001')
    console.log('EL0001 (sin orden) → fuente:', el0?.fuenteCosto, 'costoReal:', el0?.costoRealMXN, '(debe catalogo/850)')

    // Registrar la orden sugerida de EL0001
    const sug = d.ordenesSugeridas.find((o: any) => o.items.some((it: any) => it.clave === 'EL0001'))
    if (!sug) {
        console.log('!! No hay orden sugerida para EL0001 (revisa inventario). Abortando.')
        await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'DELETE', headers: H })
        return
    }
    await fetch(`${BASE}/cotizaciones/${cotId}/ordenes`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ proveedor: sug.proveedor }),
    })
    const ordenes = await j(await fetch(`${BASE}/ordenes`, { headers: H }))
    const oc = ordenes.find((o: any) => o.folioCotizacion === cot.folio)
    console.log('\nOrden registrada:', oc.folio, '· proveedor', oc.proveedor)

    // Editar la orden con costo ESPECIAL 990 SIN propagar al catálogo
    const ocFull = await j(await fetch(`${BASE}/ordenes/${oc._id}`, { headers: H }))
    const items = ocFull.items.map((it: any) => ({
        material: it.material,
        cantidad: it.cantidad,
        costoUnitario: it.clave === 'EL0001' ? 990 : it.costoUnitario,
    }))
    await fetch(`${BASE}/ordenes/${oc._id}`, { method: 'PUT', headers: H, body: JSON.stringify({ items }) })

    const catEl = await j(await fetch(`${BASE}/materiales/${el._id}`, { headers: H }))
    console.log('Catálogo EL0001 tras costo especial en la orden:', catEl.costoUnitario, '(DEBE seguir 850)')

    d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
    const el1 = filas().find((m: any) => m.clave === 'EL0001')
    console.log(
        'EL0001 con orden → fuente:',
        el1.fuenteCosto,
        '| costoReal:',
        el1.costoRealMXN,
        '(DEBE 990) | folio:',
        el1.fuenteFolio,
        '| prov:',
        el1.fuenteProveedor,
        '| importeReal:',
        el1.importeRealMXN
    )
    console.log('totalReal ahora:', d.totalReal)

    // Editar inline el costo de un material de catálogo (sin orden)
    const cat = filas().find((m: any) => m.fuenteCosto === 'catalogo' && m.material)
    if (cat) {
        console.log('\nEditar inline material catálogo', cat.clave, `de ${cat.costoRealMXN} → 1234`)
        await fetch(`${BASE}/cotizaciones/${cotId}/costo-material`, {
            method: 'PUT',
            headers: H,
            body: JSON.stringify({ material: cat.material, costoMXN: 1234 }),
        })
        d = await j(await fetch(`${BASE}/cotizaciones/${cotId}`, { headers: H }))
        const cat2 = filas().find((m: any) => m.clave === cat.clave)
        const catCatalogo = (await j(await fetch(`${BASE}/materiales`, { headers: H }))).find(
            (m: any) => m.clave === cat.clave
        )
        console.log(cat.clave, 'costoReal en detalle:', cat2.costoRealMXN, '(DEBE 1234) | catálogo:', catCatalogo.costoUnitario, '(DEBE 1234)')
    }

    // Limpieza
    await fetch(`${BASE}/cotizaciones/${cotId}`, { method: 'DELETE', headers: H })
    await fetch(`${BASE}/materiales/${el._id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ costoUnitario: 850, costoUSD: el.costoUSD }),
    })
    console.log('\nLimpieza: cotización cancelada, catálogo EL0001 restaurado a 850.')
}

main().catch((e) => console.error(e))

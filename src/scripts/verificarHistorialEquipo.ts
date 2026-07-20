// Verifica que modificar la composición de un equipo (agregar componente) genere historial sensible.
// Uso: npx ts-node src/scripts/verificarHistorialEquipo.ts
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

    // Crear un componente nuevo para agregar al equipo
    const nuevo = await (
        await fetch(`${BASE}/componentes`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({ concepto: 'Motor eléctrico', descripcion: 'prueba historial equipo' }),
        })
    ).json()
    const motor = await (await fetch(`${BASE}/componentes/${nuevo.id}`, { headers: H })).json()
    const motorVar = motor.variaciones[0]._id

    // Equipo TR-500 y sus líneas actuales
    const equipos = await (await fetch(`${BASE}/equipos`, { headers: H })).json()
    const tr = equipos.find((e: any) => e.nombre === 'Trituradora TR-500')
    const bom = await (await fetch(`${BASE}/equipos/${tr._id}`, { headers: H })).json()
    const lineasActuales = bom.lineas.map((l: any) => ({
        componente: l.componenteId,
        variacion: l.variacionId,
        cantidad: l.cantidad,
    }))
    console.log('Líneas actuales:', lineasActuales.length)

    // Agregar el Motor a la composición
    const nuevasLineas = [...lineasActuales, { componente: motor._id, variacion: motorVar, cantidad: 1 }]
    await fetch(`${BASE}/equipos/${tr._id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ lineas: nuevasLineas }),
    })

    // Historial
    const hist = await (await fetch(`${BASE}/historial`, { headers: H })).json()
    console.log(`\nHistorial (${hist.length}):`)
    hist.slice(0, 3).forEach((h: any) => {
        const sujeto = h.tipo === 'equipo' ? `EQUIPO ${h.equipoNombre}` : `COMPONENTE ${h.componenteConcepto}`
        console.log(`\n [${h.tipo}] ${h.usuario} · ${sujeto}${h.sensible ? ' (MAYOR)' : ''}`)
        h.cambios.forEach((c: string) => console.log(`   - ${c}`))
    })

    // Limpieza: quitar el Motor del equipo y borrar el componente de prueba
    await fetch(`${BASE}/equipos/${tr._id}`, { method: 'PUT', headers: H, body: JSON.stringify({ lineas: lineasActuales }) })
    await fetch(`${BASE}/componentes/${motor._id}`, { method: 'DELETE', headers: H })
}

main().catch((e) => console.error(e))

// Reconstruye datos demo válidos tras las pruebas: componente 'Tablero de control'
// con su variación + materiales, y el equipo 'Trituradora TR-500' apuntando a ella.
// Uso: npx ts-node src/scripts/reseedDemo.ts
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

    const materiales = await (await fetch(`${BASE}/materiales`, { headers: H })).json()
    const el = materiales.find((m: any) => m.clave === 'EL0001')
    const pa = materiales.find((m: any) => m.clave === 'PA0001')

    // Componente Tablero de control (crea si no existe)
    let comps = await (await fetch(`${BASE}/componentes`, { headers: H })).json()
    let tablero = comps.find((c: any) => c.concepto === 'Tablero de control')
    if (!tablero) {
        const r = await (
            await fetch(`${BASE}/componentes`, {
                method: 'POST',
                headers: H,
                body: JSON.stringify({ concepto: 'Tablero de control', descripcion: 'Tablero eléctrico principal' }),
            })
        ).json()
        tablero = { _id: r.id }
    }

    // Asegura la variación 24 VDC con sus materiales
    await fetch(`${BASE}/componentes/${tablero._id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({
            variaciones: [
                {
                    nombre: '24 VDC',
                    materiales: [
                        { material: el._id, cantidad: 3, unidad: 'Pieza', costoMXN: 850, costoUSD: 47, paridad: 18.1 },
                        { material: pa._id, cantidad: 2, unidad: 'Pieza', costoMXN: 1200, costoUSD: 66, paridad: 18.1, tipo: 'B' },
                    ],
                },
            ],
        }),
    })

    const compFull = await (await fetch(`${BASE}/componentes/${tablero._id}`, { headers: H })).json()
    const varId = compFull.variaciones[0]._id

    // Equipo Trituradora TR-500 -> una sola línea limpia
    const equipos = await (await fetch(`${BASE}/equipos`, { headers: H })).json()
    let tr = equipos.find((e: any) => e.nombre === 'Trituradora TR-500')
    if (!tr) {
        const r = await (
            await fetch(`${BASE}/equipos`, {
                method: 'POST',
                headers: H,
                body: JSON.stringify({ nombre: 'Trituradora TR-500', tipo: 'Trituradora', descripcion: 'Equipo demo' }),
            })
        ).json()
        tr = { _id: r.id }
    }
    await fetch(`${BASE}/equipos/${tr._id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ lineas: [{ componente: tablero._id, variacion: varId, cantidad: 1 }] }),
    })

    const bom = await (await fetch(`${BASE}/equipos/${tr._id}`, { headers: H })).json()
    console.log('Equipo:', bom.nombre)
    console.log('Líneas:', bom.lineas.map((l: any) => `${l.componente}/${l.variacion} x${l.cantidad}`).join(', '))
    console.log('TOTAL:', bom.resumen.totalGeneral)
}

main().catch((e) => console.error(e))

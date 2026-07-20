// Verifica que al editar un material de un componente se CONSERVE el _id de la variación
// (usa fetch con JSON real, sin el desempaquetado de arrays de PowerShell).
// Uso: npx ts-node src/scripts/verificarBugVariacion.ts
export {}
const BASE = 'http://localhost:4000/api'

async function main() {
    // login
    const loginRes = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }),
    })
    const { token } = await loginRes.json()
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

    // materiales base
    const materiales = await (await fetch(`${BASE}/materiales`, { headers: H })).json()
    const el = materiales.find((m: any) => m.clave === 'EL0001')
    const pa = materiales.find((m: any) => m.clave === 'PA0001')

    // crear componente de prueba
    const crear = await (
        await fetch(`${BASE}/componentes`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({
                concepto: 'BUGTEST Tablero',
                descripcion: 'prueba de conservación de _id',
                variaciones: [
                    {
                        nombre: '24 VDC',
                        materiales: [
                            { material: el._id, cantidad: 3, unidad: 'Pieza', costoMXN: 850, costoUSD: 47 },
                            { material: pa._id, cantidad: 2, unidad: 'Pieza', costoMXN: 1200, costoUSD: 66, tipo: 'B' },
                        ],
                    },
                ],
            }),
        })
    ).json()
    const id = crear.id

    // leer -> variacion _id ANTES
    const comp1 = await (await fetch(`${BASE}/componentes/${id}`, { headers: H })).json()
    const varAntes = comp1.variaciones[0]._id

    // editar: cambiar costo de un material, reenviando variaciones CON su _id
    comp1.variaciones[0].materiales[0].costoMXN = 777
    await fetch(`${BASE}/componentes/${id}`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ variaciones: comp1.variaciones }),
    })

    // leer -> variacion _id DESPUES
    const comp2 = await (await fetch(`${BASE}/componentes/${id}`, { headers: H })).json()
    const varDespues = comp2.variaciones[0]._id
    const costoNuevo = comp2.variaciones[0].materiales[0].costoMXN

    console.log('Variación _id ANTES:  ', varAntes)
    console.log('Variación _id DESPUÉS:', varDespues)
    console.log('¿_id conservado?:', varAntes === varDespues ? 'SÍ ✓' : 'NO ✗')
    console.log('Costo actualizado a:', costoNuevo, '(esperado 777)')

    // limpieza
    await fetch(`${BASE}/componentes/${id}`, { method: 'DELETE', headers: H })
    console.log('(componente de prueba eliminado)')
}

main().catch((e) => console.error(e))

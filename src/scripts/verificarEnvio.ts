// Verifica marcar enviada + generación de PDF de una orden.
// Uso: npx ts-node src/scripts/verificarEnvio.ts
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
    const borrador = ordenes.find((o: any) => o.estado === 'borrador')
    if (!borrador) {
        console.log('No hay orden en borrador para probar. Órdenes:', ordenes.map((o: any) => `${o.folio}:${o.estado}`))
        return
    }
    console.log(`Probando con ${borrador.folio} (${borrador.estado})`)

    // Marcar enviada con envío de correo (ELECMX tiene correo, pero no hay creds Gmail)
    const env = await (
        await fetch(`${BASE}/ordenes/${borrador._id}/enviar`, {
            method: 'PUT',
            headers: H,
            body: JSON.stringify({ enviarCorreo: true }),
        })
    ).json()
    console.log(`Marcar enviada -> ${env.mensaje} | correo=${env.correo}`)

    // Estado tras enviar
    const orden = await (await fetch(`${BASE}/ordenes/${borrador._id}`, { headers: H })).json()
    console.log(`Estado ahora: ${orden.estado} | correoEnviado=${orden.correoEnviado} | enviadaAt=${orden.enviadaAt ? 'sí' : 'no'}`)

    // Descargar PDF y validar
    const pdfRes = await fetch(`${BASE}/ordenes/${borrador._id}/pdf`, { headers: H })
    const contentType = pdfRes.headers.get('content-type')
    const buf = Buffer.from(await pdfRes.arrayBuffer())
    const magic = buf.slice(0, 5).toString('latin1')
    console.log(`PDF -> content-type=${contentType} | bytes=${buf.length} | magic="${magic}" | válido=${magic === '%PDF-'}`)
}

main().catch((e) => console.error(e))

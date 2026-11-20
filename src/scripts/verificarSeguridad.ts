// Verifica el endurecimiento de seguridad y escalabilidad (2026-10):
//  login sin enumeración + límite de intentos · revocación de sesiones · tokens viejos ·
//  cabeceras (helmet) · lista blanca en materiales · límites de cuerpo · índices ·
//  paginación/filtros de cotizaciones (incl. por paridad) y órdenes.
// Usa un usuario QA (no bloquea al admin) y lo borra al final.
// Uso: npx ts-node src/scripts/verificarSeguridad.ts
import 'dotenv/config'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import { cerrarBD } from './_qa'

const BASE = 'http://localhost:4000/api'
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')
const JSONH = { 'Content-Type': 'application/json' }

async function main() {
    const login = (email: string, password: string) =>
        fetch(`${BASE}/auth/login`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email, password }) })
    const la = await (await login('admin@triaso.com', 'admin123')).json()
    const A = { ...JSONH, Authorization: `Bearer ${la.token}` }
    const email = 'qa.seguridad@triaso.test'
    const u = await (await fetch(`${BASE}/usuarios`, { method: 'POST', headers: A, body: JSON.stringify({ nombre: 'QA Seguridad', email, password: 'qa1234', rol: 'capturista', permisos: {} }) })).json()

    try {
        // --- 1. Sin enumeración de usuarios ---
        const rNo = await login('no.existe@triaso.test', 'xxxxxx')
        const rMal = await login(email, 'xxxxxx')
        const [bNo, bMal] = [await rNo.json(), await rMal.json()]
        console.log('Correo inexistente y clave mala responden igual (401, mismo mensaje):', ok(rNo.status === 401 && rMal.status === 401 && bNo.error === bMal.error), `"${bMal.error}"`)

        // --- 2. Límite de intentos (ya hay 1 fallo de esta cuenta) ---
        for (let i = 0; i < 4; i++) await login(email, 'xxxxxx')
        const bloqueado = await login(email, 'qa1234') // contraseña CORRECTA, pero bloqueada
        console.log('6º intento (aun con la clave correcta) → 429 + Retry-After:', ok(bloqueado.status === 429 && !!bloqueado.headers.get('retry-after')), `(${(await bloqueado.json()).error})`)
        const otroOk = await login('admin@triaso.com', 'admin123')
        console.log('El bloqueo es por cuenta: otra cuenta desde la misma IP sí entra:', ok(otroOk.status === 200))

        // --- 3. Revocación de sesiones al restablecer la contraseña ---
        const tokenViejo = jwt.sign({ id: u.id, v: 0 }, process.env.JWT_SECRET!, { expiresIn: '1h' })
        const antes = await fetch(`${BASE}/auth/perfil`, { headers: { Authorization: `Bearer ${tokenViejo}` } })
        await fetch(`${BASE}/usuarios/${u.id}/password`, { method: 'PUT', headers: A, body: JSON.stringify({ password: 'qa5678' }) })
        const despues = await fetch(`${BASE}/auth/perfil`, { headers: { Authorization: `Bearer ${tokenViejo}` } })
        console.log('Sesión válida antes del reset (200) y revocada después (401):', ok(antes.status === 200 && despues.status === 401))

        // --- 4. Tokens de formato viejo (sin versión) ya no sirven ---
        const sinVersion = jwt.sign({ id: u.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
        const rSin = await fetch(`${BASE}/auth/perfil`, { headers: { Authorization: `Bearer ${sinVersion}` } })
        console.log('Token sin versión de sesión → 401:', ok(rSin.status === 401))

        // --- 5. Vigencia del token emitido por el login ---
        const exp = jwt.decode(la.token) as { exp: number; iat: number }
        const horas = (exp.exp - exp.iat) / 3600
        console.log(`Vigencia del token = ${horas} h (antes 720 h):`, ok(horas <= 12))

        // --- 6. Cambio de contraseña: clave actual errónea NO cierra sesión (400) y devuelve token nuevo ---
        const lu = await (await login('admin@triaso.com', 'admin123')).json()
        const errTecleo = await fetch(`${BASE}/auth/perfil/password`, { method: 'PUT', headers: { ...JSONH, Authorization: `Bearer ${lu.token}` }, body: JSON.stringify({ actual: 'equivocada', nueva: 'admin123' }) })
        console.log('Clave actual equivocada en "Mi perfil" → 400 (no 401):', ok(errTecleo.status === 400))

        // --- 7. Cabeceras de seguridad ---
        const h = (await fetch(`${BASE}`)).headers
        console.log('Sin X-Powered-By; con nosniff, HSTS y anti-clickjacking:', ok(!h.get('x-powered-by') && h.get('x-content-type-options') === 'nosniff' && !!h.get('strict-transport-security') && !!h.get('x-frame-options')))

        // --- 8. Lista blanca en materiales ---
        const mats = await (await fetch(`${BASE}/materiales`, { headers: A })).json()
        const m = mats[0]
        await fetch(`${BASE}/materiales/${m._id}`, { method: 'PUT', headers: A, body: JSON.stringify({ concepto: m.concepto, categoriaPrincipal: m.categoriaPrincipal, proveedorPrincipal: m.proveedorPrincipal?._id, costoUnitario: m.costoUnitario, costoUSD: m.costoUSD, moneda: m.moneda, monedaPrincipal: m.monedaPrincipal, clave: 'HACK0001', activo: false }) })
        const m2 = await (await fetch(`${BASE}/materiales/${m._id}`, { headers: A })).json()
        console.log('Material: no se puede sobrescribir clave ni activo por la API:', ok(m2.clave === m.clave && m2.activo === m.activo))

        // --- 9. Límites de tamaño ---
        const grande = JSON.stringify({ concepto: 'x'.repeat(300_000) })
        const r413 = await fetch(`${BASE}/materiales`, { method: 'POST', headers: A, body: grande })
        const rImp = await fetch(`${BASE}/proveedores/importar`, { method: 'POST', headers: A, body: JSON.stringify({ proveedores: [], relleno: 'x'.repeat(300_000) }) })
        console.log('Cuerpo de 300 KB: rechazado en rutas normales (413), aceptado en la importación:', ok(r413.status === 413 && rImp.status !== 413), `(${r413.status} / ${rImp.status})`)

        // --- 10. Índices creados ---
        if (mongoose.connection.readyState !== 1) await connectDB()
        const col = async (n: string) => (await mongoose.connection.collection(n).indexes()).map((i) => Object.keys(i.key).join('+'))
        const ih = await col('historials')
        const ic = await col('cotizacions')
        const io = await col('ordencompras')
        const im = await col('movimientoinventarios')
        console.log('Índices: bitácora, cotizaciones (paridad), órdenes (cotización) y kárdex (material):',
            ok(ih.includes('sector+createdAt') && ic.includes('paridad') && io.includes('cotizacion') && im.includes('material+createdAt')))

        // --- 11. Paginación y filtros de cotizaciones (incluye por paridad) ---
        const todas = await (await fetch(`${BASE}/cotizaciones`, { headers: A })).json()
        const p1 = await (await fetch(`${BASE}/cotizaciones?pagina=1&limite=5`, { headers: A })).json()
        console.log(`Cotizaciones paginadas: ${p1.items.length} de ${p1.total} (${p1.paginas} pág.), total = lista completa:`, ok(p1.items.length === Math.min(5, todas.length) && p1.total === todas.length))
        const conParidad = todas.find((c: { paridad: string | null }) => c.paridad)
        if (conParidad) {
            const porParidad = await (await fetch(`${BASE}/cotizaciones?pagina=1&limite=100&paridad=${conParidad.paridad}`, { headers: A })).json()
            const esperadas = todas.filter((c: { paridad: string | null }) => c.paridad === conParidad.paridad).length
            const registros = await (await fetch(`${BASE}/paridad`, { headers: A })).json()
            const conteoParidad = registros.find((r: { _id: string }) => r._id === conParidad.paridad)?.cotizaciones
            console.log(`Filtro por registro de paridad: ${porParidad.total} = conteo del módulo Paridad (${conteoParidad}):`, ok(porParidad.total === esperadas && porParidad.total === conteoParidad))
            const tc = conParidad.tipoCambio
            const porRango = await (await fetch(`${BASE}/cotizaciones?pagina=1&limite=100&tcMin=${tc}&tcMax=${tc}`, { headers: A })).json()
            console.log(`Filtro por rango de tipo de cambio [${tc}, ${tc}]:`, ok(porRango.items.every((c: { tipoCambio: number }) => c.tipoCambio === tc) && porRango.total >= 1))
        }
        const malId = await fetch(`${BASE}/cotizaciones?pagina=1&paridad=no-es-id`, { headers: A })
        const raro = await fetch(`${BASE}/cotizaciones?pagina=1&q=${encodeURIComponent('(.*)+[')}`, { headers: A })
        console.log('Entradas raras: paridad inválida 400; texto con símbolos de regex no rompe (200):', ok(malId.status === 400 && raro.status === 200))

        // --- 12. Paginación de órdenes ---
        const ords = await (await fetch(`${BASE}/ordenes`, { headers: A })).json()
        const po = await (await fetch(`${BASE}/ordenes?pagina=1&limite=5`, { headers: A })).json()
        const conItems = po.items.every((o: { totalItems: number }) => typeof o.totalItems === 'number')
        console.log(`Órdenes paginadas: ${po.items.length} de ${po.total}, con conteo de materiales:`, ok(po.total === ords.length && conItems))
    } finally {
        await fetch(`${BASE}/usuarios/${u.id}`, { method: 'DELETE', headers: A })
        if (mongoose.connection.readyState !== 1) await connectDB()
        await mongoose.connection.collection('historials').deleteMany({ entidad: { $regex: 'QA Seguridad' } })
        await cerrarBD()
        console.log('\n(usuario QA borrado)')
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})

// Verifica campos personalizados en los 6 módulos (materiales, proveedores, componentes,
// equipos, inventario, órdenes): definición por módulo, limpieza tipada, conservación de
// valores de campos OCULTOS, bitácora, lista blanca de módulos y permiso de lectura.
// Respalda y RESTAURA la configuración de campos real; usa registros QA y los borra al final.
// Uso: npx ts-node src/scripts/verificarCamposModulos.ts
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Historial from '../models/Historial'
import { cerrarBD } from './_qa'

const BASE = 'http://localhost:4000/api'
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')
const MODULOS = ['materiales', 'proveedores', 'componentes', 'equipos', 'inventario', 'ordenes'] as const

async function main() {
    const j = async (r: Response) => r.json()
    const login = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) }))
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }
    const put = (url: string, body: unknown) => fetch(`${BASE}${url}`, { method: 'PUT', headers: H, body: JSON.stringify(body) })
    const post = async (url: string, body: unknown) => j(await fetch(`${BASE}${url}`, { method: 'POST', headers: H, body: JSON.stringify(body) }))
    const get = async (url: string, h = H) => j(await fetch(`${BASE}${url}`, { headers: h }))

    // --- Respaldo de la configuración real de campos ---
    const cfg = await get('/configuracion')
    const respaldo: Record<string, unknown[]> = cfg.campos
    console.log('Módulos en /configuracion.campos:', ok(MODULOS.every((m) => Array.isArray(respaldo[m]))))

    const creados: { url: string }[] = []
    let qaUser = ''
    try {
        // --- Definir 3 campos QA en cada módulo: texto, número, sí/no (el de número se ocultará luego) ---
        const ids: Record<string, { txt: string; num: string; sino: string }> = {}
        for (const m of MODULOS) {
            const lista = [
                ...(respaldo[m] as object[]),
                { id: '', nombre: 'QA Texto', tipo: 'texto', opciones: [], activo: true },
                { id: '', nombre: 'QA Numero', tipo: 'numero', opciones: [], activo: true },
                { id: '', nombre: 'QA SiNo', tipo: 'siNo', opciones: [], activo: true },
            ]
            await put('/configuracion', { campos: { modulo: m, lista } })
            const activos = await get(`/configuracion/campos/${m}`)
            const id = (n: string) => activos.find((c: { nombre: string }) => c.nombre === n)?.id
            ids[m] = { txt: id('QA Texto'), num: id('QA Numero'), sino: id('QA SiNo') }
        }
        console.log('Campos QA definidos en los 6 módulos:', ok(MODULOS.every((m) => ids[m].txt && ids[m].num && ids[m].sino)))

        const valores = (m: string) => ({ [ids[m].txt]: 'hola', [ids[m].num]: '42', [ids[m].sino]: 'true', basura: 'x' })
        const tipado = (p: Record<string, unknown> | undefined, m: string) =>
            !!p && p[ids[m].txt] === 'hola' && p[ids[m].num] === 42 && p[ids[m].sino] === true && !('basura' in p)

        // --- Crear un registro QA por módulo con valores ---
        const prov = await post('/proveedores', { codigo: 'QACAMPOS', razonSocial: 'QA Campos SA', personalizados: valores('proveedores') })
        creados.push({ url: `/proveedores/${prov.id}` })
        const mat = await post('/materiales', { concepto: 'QA material campos', categoriaPrincipal: 'A', proveedorPrincipal: prov.id, costoUnitario: 10, moneda: 'mxn', personalizados: valores('materiales') })
        creados.unshift({ url: `/materiales/${mat.id}` })
        const comp = await post('/componentes', { concepto: 'QA componente campos', personalizados: valores('componentes') })
        creados.unshift({ url: `/componentes/${comp.id}` })
        const eq = await post('/equipos', { nombre: 'QA equipo campos', personalizados: valores('equipos') })
        creados.unshift({ url: `/equipos/${eq.id}` })
        const inv = await post('/inventario', { material: mat.id, cantidad: 0, personalizados: valores('inventario') })
        creados.unshift({ url: `/inventario/${inv.id}` })
        const oc = await post('/ordenes', { proveedor: prov.id, items: [{ material: mat.id, cantidad: 1 }], personalizados: valores('ordenes') })
        creados.unshift({ url: `/ordenes/${oc.id}` })

        const leer = {
            proveedores: async () => (await get(`/proveedores/${prov.id}`)).proveedor?.personalizados,
            materiales: async () => (await get(`/materiales/${mat.id}`)).personalizados,
            componentes: async () => (await get(`/componentes/${comp.id}`)).personalizados,
            equipos: async () => (await get(`/equipos/${eq.id}`)).personalizados,
            inventario: async () => (await get('/inventario')).find((i: { _id: string }) => i._id === inv.id)?.personalizados,
            ordenes: async () => (await get(`/ordenes/${oc.id}`)).personalizados,
        }
        for (const m of MODULOS) console.log(`Alta ${m}: valores tipados y basura descartada:`, ok(tipado(await leer[m](), m)))

        // --- Ocultar el campo número y editar mandando SOLO los activos: el valor oculto debe conservarse ---
        for (const m of MODULOS) {
            const def = (await get('/configuracion')).campos[m].map((c: { id: string; activo: boolean }) => (c.id === ids[m].num ? { ...c, activo: false } : c))
            await put('/configuracion', { campos: { modulo: m, lista: def } })
        }
        const edicion = (m: string) => ({ [ids[m].txt]: 'adios', [ids[m].sino]: false })
        await put(`/proveedores/${prov.id}`, { codigo: 'QACAMPOS', razonSocial: 'QA Campos SA', personalizados: edicion('proveedores') })
        await put(`/materiales/${mat.id}`, { concepto: 'QA material campos', categoriaPrincipal: 'A', proveedorPrincipal: prov.id, costoUnitario: 10, personalizados: edicion('materiales') })
        await put(`/componentes/${comp.id}`, { personalizados: edicion('componentes') })
        await put(`/equipos/${eq.id}`, { personalizados: edicion('equipos') })
        await put(`/inventario/${inv.id}`, { personalizados: edicion('inventario') })
        await put(`/ordenes/${oc.id}`, { personalizados: edicion('ordenes') })
        for (const m of MODULOS) {
            const p = (await leer[m]()) as Record<string, unknown>
            console.log(`Edición ${m}: oculto conservado (42), activos actualizados:`, ok(p?.[ids[m].num] === 42 && p?.[ids[m].txt] === 'adios' && p?.[ids[m].sino] === false))
        }
        const activosProv = await get('/configuracion/campos/proveedores')
        console.log('Campo oculto NO se entrega a los formularios:', ok(!activosProv.some((c: { id: string }) => c.id === ids.proveedores.num)))

        // --- Bitácora con el diff de datos adicionales ---
        const hist = await get('/historial?sector=catalogos')
        const reg = hist.find((h: { entidad: string; cambios: string[] }) => h.entidad.includes('QACAMPOS') && h.cambios.some((c) => c.startsWith('QA Texto: hola → adios')))
        console.log('Bitácora registra "QA Texto: hola → adios" (proveedor):', ok(!!reg))

        // --- Lista blanca de módulos ---
        const r404 = await fetch(`${BASE}/configuracion/campos/usuarios`, { headers: H })
        const r400 = await put('/configuracion', { campos: { modulo: 'usuarios', lista: [] } })
        console.log('Módulo no permitido: GET 404 / PUT 400:', ok(r404.status === 404 && r400.status === 400))

        // --- Permiso: un almacenista no ve proveedores → tampoco sus campos ---
        const u = await post('/usuarios', { nombre: 'QA Campos', email: 'qa.campos@triaso.test', password: 'qa1234', rol: 'almacenista', permisos: {} })
        qaUser = u.id
        const lu = await j(await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa.campos@triaso.test', password: 'qa1234' }) }))
        const HU = { Authorization: `Bearer ${lu.token}` }
        const sinPermiso = await fetch(`${BASE}/configuracion/campos/proveedores`, { headers: HU })
        const conPermiso = await fetch(`${BASE}/configuracion/campos/inventario`, { headers: HU })
        console.log('Almacenista: campos de proveedores 403 / de inventario 200:', ok(sinPermiso.status === 403 && conPermiso.status === 200))
    } finally {
        // --- Limpieza: registros QA, usuario QA, configuración original y bitácora QA ---
        for (const c of creados) await fetch(`${BASE}${c.url}`, { method: 'DELETE', headers: H })
        if (qaUser) await fetch(`${BASE}/usuarios/${qaUser}`, { method: 'DELETE', headers: H })
        for (const m of MODULOS) await put('/configuracion', { campos: { modulo: m, lista: respaldo[m] } })
        const fin = await get('/configuracion')
        const restaurado = MODULOS.every((m) => JSON.stringify(fin.campos[m]) === JSON.stringify(respaldo[m]))
        if (mongoose.connection.readyState !== 1) await connectDB()
        const r = await Historial.deleteMany({
            $or: [
                { entidad: { $regex: 'QA |QACAMPOS|QA Campos' } },
                { entidad: { $regex: '^Campos personalizados' }, cambios: { $elemMatch: { $regex: 'QA (Texto|Numero|SiNo)' } } },
            ],
        })
        await cerrarBD()
        console.log(`\n(limpieza: registros y usuario QA borrados; configuración de campos restaurada: ${restaurado ? 'sí' : 'NO'}; ${r.deletedCount} entradas de bitácora QA quitadas)`)
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})

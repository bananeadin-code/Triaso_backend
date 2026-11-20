// Carga un set de datos DEMO completo en una base vacía (o la completa si ya hay algo).
// Va por la API, así respeta las mismas reglas que la app (claves, snapshots, permisos).
// Es idempotente: si un dato ya existe (por código/concepto/nombre) no lo duplica. No borra nada.
//
// Requiere el servidor corriendo (npm run dev) y un admin creado (crearAdmin.ts).
// Uso:
//   npx ts-node src/scripts/seedDemo.ts                          -> entra como admin@triaso.com / admin123
//   npx ts-node src/scripts/seedDemo.ts correo@x.com MiClave     -> con tus credenciales de admin
//   ... --usuarios   -> además crea un usuario demo por rol (contraseña: demo123)
import 'dotenv/config'
export {}

const BASE = `http://localhost:${process.env.PORT || 4000}/api`

if (process.env.NODE_ENV === 'production') {
    console.error('seedDemo no se ejecuta con NODE_ENV=production')
    process.exit(1)
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const conUsuarios = process.argv.includes('--usuarios')
const EMAIL = args[0] ?? 'admin@triaso.com'
const PASSWORD = args[1] ?? 'admin123'

let H: Record<string, string> = { 'Content-Type': 'application/json' }

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
    const data = await r.json().catch(() => null)
    if (!r.ok) {
        const detalle = data?.error ?? data?.errors?.map((e: any) => e.msg).join(', ') ?? r.statusText
        throw new Error(`${method} ${path} -> ${r.status}: ${detalle}`)
    }
    return data as T
}

// ---------- Datos demo ----------
const PROVEEDORES = [
    { codigo: 'ACEROSDGO', razonSocial: 'Aceros y Perfiles de Durango S.A. de C.V.', rfc: 'APD010101AB1', telefono: '618 100 2000', email: 'ventas@acerosdgo.demo' },
    { codigo: 'ELECMX', razonSocial: 'Eléctrica Industrial Mexicana S.A. de C.V.', rfc: 'EIM020202CD2', telefono: '618 200 3000', email: 'pedidos@elecmx.demo' },
    { codigo: 'MAQNORTE', razonSocial: 'Maquinados del Norte S. de R.L.', rfc: 'MNO030303EF3', telefono: '618 300 4000', email: 'compras@maqnorte.demo' },
    { codigo: 'PINTUDGO', razonSocial: 'Pinturas y Recubrimientos Durango', rfc: 'PRD040404GH4', telefono: '618 400 5000', email: 'contacto@pintudgo.demo' },
]

// categoría: A Pailería · B Maquinados · C Componentes · D Eléctrico y control · E Acabado
const MATERIALES = [
    { concepto: 'Placa de acero A36 1/4"', cat: 'A', prov: 'ACEROSDGO', alt: ['MAQNORTE'], mxn: 1850, usd: 102 },
    { concepto: 'Perfil PTR 4x4" cal. 11', cat: 'A', prov: 'ACEROSDGO', alt: [], mxn: 1200, usd: 66 },
    { concepto: 'Flecha maquinada 2" acero 1045', cat: 'B', prov: 'MAQNORTE', alt: [], mxn: 3400, usd: 188 },
    { concepto: 'Buje de bronce 2"', cat: 'B', prov: 'MAQNORTE', alt: [], mxn: 650, usd: 36 },
    { concepto: 'Chumacera de piso 2"', cat: 'C', prov: 'MAQNORTE', alt: ['ACEROSDGO'], mxn: 980, usd: 54 },
    { concepto: 'Motor trifásico 10 HP', cat: 'C', prov: 'ELECMX', alt: [], mxn: 14500, usd: 801 },
    { concepto: 'Relevador de control 24 VDC', cat: 'D', prov: 'ELECMX', alt: [], mxn: 850, usd: 47 },
    { concepto: 'Arrancador suave 10 HP', cat: 'D', prov: 'ELECMX', alt: [], mxn: 7200, usd: 398 },
    { concepto: 'Cable THW cal. 10 (metro)', cat: 'D', prov: 'ELECMX', alt: [], mxn: 28, usd: 1.55 },
    { concepto: 'Primario anticorrosivo (galón)', cat: 'E', prov: 'PINTUDGO', alt: [], mxn: 540, usd: 30 },
    { concepto: 'Esmalte industrial (galón)', cat: 'E', prov: 'PINTUDGO', alt: [], mxn: 720, usd: 40 },
]

// Stock: algunos completos, otros cortos o en cero para que se vean faltantes y órdenes sugeridas
const INVENTARIO: Record<string, { cantidad: number; ubicacion: string }> = {
    'Placa de acero A36 1/4"': { cantidad: 10, ubicacion: 'Patio A' },
    'Perfil PTR 4x4" cal. 11': { cantidad: 2, ubicacion: 'Patio A' },
    'Buje de bronce 2"': { cantidad: 8, ubicacion: 'Anaquel B-2' },
    'Chumacera de piso 2"': { cantidad: 1, ubicacion: 'Anaquel B-1' },
    'Relevador de control 24 VDC': { cantidad: 5, ubicacion: 'Gabinete E-1' },
    'Cable THW cal. 10 (metro)': { cantidad: 150, ubicacion: 'Carrete E-3' },
    'Primario anticorrosivo (galón)': { cantidad: 4, ubicacion: 'Almacén pintura' },
}

type Uso = [concepto: string, cantidad: number, unidad?: string]
const COMPONENTES: { concepto: string; descripcion: string; variaciones: { nombre: string; materiales: Uso[] }[] }[] = [
    {
        concepto: 'Chasis estructural',
        descripcion: 'Base soldada del equipo',
        variaciones: [
            { nombre: 'Estándar', materiales: [['Placa de acero A36 1/4"', 3], ['Perfil PTR 4x4" cal. 11', 6]] },
            { nombre: 'Reforzado', materiales: [['Placa de acero A36 1/4"', 5], ['Perfil PTR 4x4" cal. 11', 9]] },
        ],
    },
    {
        concepto: 'Sistema de transmisión',
        descripcion: 'Motor, flecha y apoyos',
        variaciones: [
            {
                nombre: '10 HP',
                materiales: [['Motor trifásico 10 HP', 1], ['Flecha maquinada 2" acero 1045', 1], ['Chumacera de piso 2"', 2], ['Buje de bronce 2"', 2]],
            },
        ],
    },
    {
        concepto: 'Tablero de control',
        descripcion: 'Tablero eléctrico principal',
        variaciones: [
            { nombre: '24 VDC', materiales: [['Relevador de control 24 VDC', 3], ['Arrancador suave 10 HP', 1], ['Cable THW cal. 10 (metro)', 40, 'Metro']] },
        ],
    },
    {
        concepto: 'Acabado',
        descripcion: 'Pintura del equipo completo',
        variaciones: [{ nombre: 'Industrial', materiales: [['Primario anticorrosivo (galón)', 3], ['Esmalte industrial (galón)', 4]] }],
    },
]

type Linea = [componente: string, variacion: string, cantidad: number]
const EQUIPOS: { nombre: string; tipo: string; descripcion: string; lineas: Linea[] }[] = [
    {
        nombre: 'Trituradora TR-500',
        tipo: 'Trituradora',
        descripcion: 'Equipo demo de trituración',
        lineas: [['Chasis estructural', 'Reforzado', 1], ['Sistema de transmisión', '10 HP', 1], ['Tablero de control', '24 VDC', 1], ['Acabado', 'Industrial', 1]],
    },
    {
        nombre: 'Banda transportadora BT-200',
        tipo: 'Manufactura',
        descripcion: 'Equipo demo de transporte',
        lineas: [['Chasis estructural', 'Estándar', 2], ['Sistema de transmisión', '10 HP', 1], ['Acabado', 'Industrial', 1]],
    },
]

const USUARIOS_DEMO = [
    { rol: 'operador', nombre: 'Operador Demo' },
    { rol: 'cotizador', nombre: 'Cotizador Demo' },
    { rol: 'comprador', nombre: 'Comprador Demo' },
    { rol: 'capturista', nombre: 'Capturista Demo' },
    { rol: 'almacenista', nombre: 'Almacenista Demo' },
]

// ---------- Carga ----------
const creados: Record<string, number> = {}
const cuenta = (k: string) => (creados[k] = (creados[k] ?? 0) + 1)

async function main() {
    const login = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    }).catch(() => null)
    if (!login) throw new Error(`No hay servidor en ${BASE}. Arráncalo con: npm run dev`)
    if (!login.ok) throw new Error(`No se pudo entrar como ${EMAIL}. Pasa tus credenciales: seedDemo.ts correo clave`)
    H = { ...H, Authorization: `Bearer ${(await login.json()).token}` }

    // Proveedores
    const provs = await api<any[]>('GET', '/proveedores')
    const provId: Record<string, string> = Object.fromEntries(provs.map((p) => [p.codigo, p._id]))
    for (const p of PROVEEDORES) {
        if (provId[p.codigo]) continue
        provId[p.codigo] = (await api('POST', '/proveedores', p)).id ?? (await api<any[]>('GET', '/proveedores')).find((x) => x.codigo === p.codigo)._id
        cuenta('proveedores')
    }

    // Materiales
    const mats = await api<any[]>('GET', '/materiales')
    const mat: Record<string, any> = Object.fromEntries(mats.map((m) => [m.concepto, m]))
    for (const m of MATERIALES) {
        if (mat[m.concepto]) continue
        await api('POST', '/materiales', {
            concepto: m.concepto,
            categoriaPrincipal: m.cat,
            proveedorPrincipal: provId[m.prov],
            proveedoresAsociados: m.alt.map((c) => provId[c]),
            costoUnitario: m.mxn,
            costoUSD: m.usd,
        })
        cuenta('materiales')
    }
    for (const m of await api<any[]>('GET', '/materiales')) mat[m.concepto] = m

    // Inventario (solo si el material aún no tiene renglón)
    const inv = await api<any[]>('GET', '/inventario')
    const conStock = new Set(inv.map((i) => String(i.material?._id ?? i.material)))
    for (const [concepto, d] of Object.entries(INVENTARIO)) {
        const id = mat[concepto]._id
        if (conStock.has(String(id))) continue
        await api('POST', '/inventario', { material: id, ...d })
        cuenta('inventario')
    }

    // Componentes
    const costo = (concepto: string) => MATERIALES.find((m) => m.concepto === concepto)!
    const comps = await api<any[]>('GET', '/componentes')
    const comp: Record<string, any> = Object.fromEntries(comps.map((c) => [c.concepto, c]))
    for (const c of COMPONENTES) {
        if (comp[c.concepto]) continue
        await api('POST', '/componentes', {
            concepto: c.concepto,
            descripcion: c.descripcion,
            variaciones: c.variaciones.map((v) => ({
                nombre: v.nombre,
                materiales: v.materiales.map(([concepto, cantidad, unidad]) => {
                    const ref = costo(concepto)
                    return {
                        material: mat[concepto]._id,
                        cantidad,
                        unidad: unidad ?? 'Pieza',
                        costoMXN: ref.mxn,
                        costoUSD: ref.usd,
                        paridad: +(ref.mxn / ref.usd).toFixed(2),
                    }
                }),
            })),
        })
        cuenta('componentes')
    }
    for (const c of await api<any[]>('GET', '/componentes')) comp[c.concepto] = await api('GET', `/componentes/${c._id}`)

    // Equipos (BOM)
    const eqs = await api<any[]>('GET', '/equipos')
    const eq: Record<string, any> = Object.fromEntries(eqs.map((e) => [e.nombre, e]))
    for (const e of EQUIPOS) {
        if (eq[e.nombre]) continue
        const lineas = e.lineas.map(([concepto, variacion, cantidad]) => {
            const c = comp[concepto]
            const v = c.variaciones.find((x: any) => x.nombre === variacion)
            return { componente: c._id, variacion: v._id, cantidad }
        })
        const r = await api('POST', '/equipos', { nombre: e.nombre, tipo: e.tipo, descripcion: e.descripcion, lineas })
        eq[e.nombre] = { _id: r.id }
        cuenta('equipos')
    }

    // Una cotización demo (solo si no hay ninguna), para ver faltantes y órdenes sugeridas
    const cots = await api<any[]>('GET', '/cotizaciones')
    if (cots.length === 0) {
        await api('POST', '/cotizaciones', { equipo: eq['Trituradora TR-500']._id, contexto: 'creacion' })
        cuenta('cotizaciones')
    }

    // Usuarios demo por rol (opcional)
    if (conUsuarios) {
        const { usuarios } = await api<{ usuarios: any[] }>('GET', '/usuarios')
        const existentes = new Set(usuarios.map((u) => u.email))
        for (const u of USUARIOS_DEMO) {
            const email = `${u.rol}@triaso.demo`
            if (existentes.has(email)) continue
            await api('POST', '/usuarios', {
                nombre: u.nombre,
                email,
                password: 'demo123',
                debeCambiarPassword: false, // credenciales demo conocidas
                rol: u.rol,
                permisos: { limpiarHistoriales: false, generarReportes: true },
            })
            cuenta('usuarios')
        }
    }

    const resumen = Object.entries(creados).map(([k, n]) => `  ${k}: ${n}`).join('\n')
    console.log(resumen ? `Datos demo creados:\n${resumen}` : 'Los datos demo ya estaban completos. Nada que crear.')
    if (conUsuarios) console.log('Usuarios demo: <rol>@triaso.demo / demo123')
}

main().catch((e) => {
    console.error(e.message)
    process.exit(1)
})

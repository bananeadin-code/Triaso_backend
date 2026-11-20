// Importación de un BOM real desde Excel con ZONA DE REVISIÓN (nada entra directo al catálogo).
//
//  1. analizarBOM(archivo, decisiones) → concilia contra los catálogos SIN escribir nada:
//     proveedores (por código), materiales (por clave; conflictos de clave; precios distintos;
//     parecidos por concepto), componentes (por nombre; compara materiales con cada variación),
//     equipo (por nombre), unidades (sinónimos) y verificación de totales contra el Excel.
//     El front lo vuelve a llamar cada vez que el usuario cambia una decisión: la lógica vive aquí.
//  2. aplicarBOM(...) → escribe todo como un LOTE (folio IMP0001) y marca lo nuevo "por validar".
//     Si algo falla a medias, revierte lo que alcanzó a crear.
//  3. deshacerLote(...) → revierte el lote completo, solo si lo creado no se usó ya en otra parte.
//
// Reglas acordadas con Triaso (2026-10-26):
//  - Sus claves (A13074…) son la clave OFICIAL del material.
//  - Cada sección del Excel es un componente. Si es nuevo, entra con una variación (nombre editable).
//    Si ya existe: si alguna variación tiene exactamente los mismos materiales y cantidades se usa
//    esa; si no, se propone agregar una variación nueva con esos materiales.
//  - Precios con IVA incluido: se guardan tal cual.
import { Types } from 'mongoose'
import Proveedor from '../models/Proveedor'
import Material from '../models/Material'
import Componente from '../models/Componente'
import Equipo from '../models/Equipo'
import Cotizacion from '../models/Cotizacion'
import Inventario from '../models/Inventario'
import OrdenCompra from '../models/OrdenCompra'
import ImportacionLote, { IImportacionLote } from '../models/ImportacionLote'
import { getCategoriasConfig, getConfiguracion, getTipoCambio, getUnidades } from '../models/Configuracion'
import { sincComponentesDesdeMaterial } from './sincronizarCostos'
import { registrarHistorial } from './historial'

// ---------- Entrada (la arma el front al leer el Excel) ----------
export interface FilaBOM {
    clave: string
    concepto: string
    proveedor: string
    tipo: string
    cantidad: number
    unidad: string
    pesos: number
    dolares: number
    paridad?: number // tipo de cambio con que el Excel convierte los precios en dólares
}
export interface ArchivoBOM {
    archivo: string
    equipo: { clave: string; nombre: string; observaciones?: string }
    secciones: { nombre: string; filas: FilaBOM[] }[]
    sumas?: Record<string, number> // totales por categoría que trae el Excel (A..E, total)
}

// ---------- Decisiones del usuario en la revisión ----------
export type AccionComponente = 'crear' | 'usarVariacion' | 'nuevaVariacion' | 'omitir'
export interface Decisiones {
    equipo?: { nombre?: string; descripcion?: string; accion?: 'crear' | 'reemplazar' }
    proveedores?: Record<string, { accion: 'crear' | 'vincular'; id?: string }>
    // Por clave del archivo: si sus conceptos distintos se separan en materiales distintos o se unifican
    conflictos?: Record<string, 'separar' | 'unificar'>
    // Por clave FINAL: crear nuevo o vincular a un material existente parecido; actualizar precio del catálogo
    materiales?: Record<string, { accion?: 'crear' | 'vincular'; id?: string; actualizarPrecio?: boolean }>
    componentes?: Record<number, { nombre?: string; accion?: AccionComponente; componenteId?: string; variacionId?: string; nombreVariacion?: string }>
}

// ---------- Utilidades ----------
const norm = (s: unknown) =>
    String(s ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
const tokens = (s: string) => new Set(norm(s).split(/[^a-z0-9/".'-]+/).filter((t) => t.length >= 2))
const similitud = (a: Set<string>, b: Set<string>) => {
    if (!a.size || !b.size) return 0
    let comun = 0
    for (const t of a) if (b.has(t)) comun++
    return comun / (a.size + b.size - comun)
}
const num = (v: unknown) => (isNaN(Number(v)) ? 0 : Number(v))
const moda = (vals: number[]) => {
    const c = new Map<number, number>()
    for (const v of vals) c.set(v, (c.get(v) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
}

// Unidades del Excel → unidades del catálogo de Configuración
const SINONIMOS: Record<string, string> = {
    pza: 'Pieza', pzas: 'Pieza', pz: 'Pieza', pieza: 'Pieza', piezas: 'Pieza',
    mts: 'Metro', mt: 'Metro', m: 'Metro', metro: 'Metro', metros: 'Metro',
    lts: 'Litro', lt: 'Litro', l: 'Litro', litro: 'Litro', litros: 'Litro',
    kg: 'Kilogramo', kgs: 'Kilogramo', kilo: 'Kilogramo', kilogramo: 'Kilogramo', kilos: 'Kilogramo',
    jgo: 'Juego', juego: 'Juego', juegos: 'Juego',
    rollo: 'Rollo', rollos: 'Rollo', caja: 'Caja', cajas: 'Caja', cja: 'Caja', par: 'Par', pares: 'Par',
}
function mapearUnidad(u: string, catalogo: string[]): string {
    const n = norm(u).replace(/\.$/, '')
    if (!n) return 'Pieza'
    const directa = catalogo.find((c) => norm(c) === n)
    if (directa) return directa
    if (SINONIMOS[n] && catalogo.some((c) => c === SINONIMOS[n])) return SINONIMOS[n]
    // Unidad desconocida: se conserva con mayúscula inicial y se agregará al catálogo
    const t = String(u).trim()
    return t.charAt(0).toUpperCase() + t.slice(1)
}

// ---------- Resultado del análisis ----------
type Diferencias = { faltan: string[]; sobran: string[]; cantidad: string[] }
export interface Analisis {
    equipo: { nombre: string; descripcion: string; clave: string; existente: { id: string; nombre: string; lineas: number } | null; accion: 'crear' | 'reemplazar' | null }
    proveedores: { codigo: string; usos: number; existente: { id: string; codigo: string; razonSocial: string } | null; accion: 'crear' | 'vincular'; id?: string }[]
    materiales: {
        clave: string // clave final (con sufijo -2, -3… si se separó un conflicto)
        claveArchivo: string
        concepto: string
        proveedor: string
        tipo: string
        unidad: string
        pesos: number
        dolares: number
        preciosArchivo: number[] // precios distintos con que aparece en el archivo
        usos: number
        estado: 'existe' | 'nuevo'
        existente: { id: string; concepto: string; costoUnitario: number; costoUSD: number; porValidar: boolean } | null
        conceptoDistinto: boolean
        precioDistinto: boolean
        parecidos: { id: string; clave: string; concepto: string; similitud: number }[]
        accion: 'crear' | 'vincular' | 'existe'
        vinculadoA?: string
        actualizarPrecio: boolean
    }[]
    conflictos: { clave: string; variantes: { concepto: string; usos: number; precios: number[] }[]; decision: 'separar' | 'unificar' }[]
    componentes: {
        idx: number
        nombreArchivo: string
        nombre: string
        grupo: string
        materiales: number
        importe: number
        existente: { id: string; concepto: string; planeado: boolean; variaciones: { id: string; nombre: string; coincide: boolean; diferencias: Diferencias }[] } | null
        accion: AccionComponente
        variacionId?: string
        nombreVariacion: string
    }[]
    unidades: { archivo: string; catalogo: string; nueva: boolean; usos: number }[]
    verificacion: { categoria: string; excel: number | null; importado: number }[]
    bloqueos: string[]
    avisos: string[]
    resumen: { secciones: number; grupos: number; renglones: number }
}

// Variación existente (o planeada en este mismo archivo) → mapa clave → cantidad
const mapaVariacion = (mats: { clave: string; cantidad: number }[]) => {
    const m = new Map<string, number>()
    for (const x of mats) m.set(x.clave.toUpperCase(), (m.get(x.clave.toUpperCase()) ?? 0) + num(x.cantidad))
    return m
}
function comparar(excel: Map<string, number>, variacion: Map<string, number>): Diferencias {
    const d: Diferencias = { faltan: [], sobran: [], cantidad: [] }
    for (const [k, c] of excel) {
        if (!variacion.has(k)) d.faltan.push(k)
        else if (Math.abs((variacion.get(k) ?? 0) - c) > 1e-6) d.cantidad.push(`${k}: ${variacion.get(k)} → ${c}`)
    }
    for (const k of variacion.keys()) if (!excel.has(k)) d.sobran.push(k)
    return d
}
const coincide = (d: Diferencias) => !d.faltan.length && !d.sobran.length && !d.cantidad.length

// ===================================================================================
export async function analizarBOM(arch: ArchivoBOM, dec: Decisiones = {}): Promise<Analisis> {
    const bloqueos: string[] = []
    const avisos: string[] = []
    const cats = (await getCategoriasConfig()).map((c) => c.id)
    const catalogoUnidades = await getUnidades()

    // ---- Secciones: las que no tienen materiales son encabezados de grupo ----
    let grupo = ''
    const secciones: { idx: number; nombre: string; grupo: string; filas: FilaBOM[] }[] = []
    let grupos = 0
    arch.secciones.forEach((s, idx) => {
        const filas = (s.filas ?? []).filter((f) => String(f.clave ?? '').trim() || String(f.concepto ?? '').trim())
        if (filas.length === 0) {
            grupo = String(s.nombre).trim()
            grupos++
        } else secciones.push({ idx, nombre: String(s.nombre).trim() || `Sección ${idx + 1}`, grupo, filas })
    })
    const todasFilas = secciones.flatMap((s) => s.filas)

    // ---- Unidades ----
    const usosUnidad = new Map<string, number>()
    for (const f of todasFilas) usosUnidad.set(String(f.unidad).trim(), (usosUnidad.get(String(f.unidad).trim()) ?? 0) + 1)
    const unidades = [...usosUnidad.entries()].map(([u, usos]) => {
        const catalogo = mapearUnidad(u, catalogoUnidades)
        return { archivo: u || '(vacía)', catalogo, nueva: !catalogoUnidades.includes(catalogo), usos }
    })
    const unidadDe = (u: string) => mapearUnidad(u, catalogoUnidades)

    // ---- Proveedores (por código, sin importar mayúsculas) ----
    const provsBD = await Proveedor.find().select('codigo razonSocial').lean()
    const usosProv = new Map<string, number>()
    for (const f of todasFilas) {
        const c = String(f.proveedor ?? '').trim().toUpperCase() || 'PENDIENTE'
        usosProv.set(c, (usosProv.get(c) ?? 0) + 1)
    }
    const proveedores = [...usosProv.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([codigo, usos]) => {
            const ex = provsBD.find((p) => p.codigo.toUpperCase() === codigo)
            const d = dec.proveedores?.[codigo]
            const existente = ex ? { id: String(ex._id), codigo: ex.codigo, razonSocial: ex.razonSocial } : null
            if (existente) return { codigo, usos, existente, accion: 'vincular' as const, id: existente.id }
            if (d?.accion === 'vincular' && d.id && provsBD.some((p) => String(p._id) === d.id))
                return { codigo, usos, existente: null, accion: 'vincular' as const, id: d.id }
            return { codigo, usos, existente: null, accion: 'crear' as const }
        })

    // ---- Materiales: por clave del archivo, variantes por concepto ----
    type Variante = { concepto: string; filas: FilaBOM[] }
    const porClave = new Map<string, Variante[]>()
    let sinClave = 0
    for (const f of todasFilas) {
        let clave = String(f.clave ?? '').trim().toUpperCase()
        if (!clave) {
            // Renglón sin clave: se le asigna una provisional (se ve y se puede vincular en la revisión)
            sinClave++
            clave = `SC-${String(sinClave).padStart(4, '0')}`
            f.clave = clave
        }
        const vs = porClave.get(clave) ?? []
        const v = vs.find((x) => norm(x.concepto) === norm(f.concepto))
        if (v) v.filas.push(f)
        else vs.push({ concepto: String(f.concepto).trim(), filas: [f] })
        porClave.set(clave, vs)
    }
    if (sinClave) avisos.push(`${sinClave} renglón(es) sin clave recibieron una clave provisional (SC-0001…).`)

    // Clave final de cada renglón (separar conflicto = sufijo -2, -3… por concepto)
    const conflictos: Analisis['conflictos'] = []
    const claveFinal = new Map<FilaBOM, string>()
    for (const [clave, vs] of porClave) {
        let decision: 'separar' | 'unificar' = 'separar'
        if (vs.length > 1) {
            decision = dec.conflictos?.[clave] ?? 'separar'
            conflictos.push({ clave, variantes: vs.map((v) => ({ concepto: v.concepto, usos: v.filas.length, precios: [...new Set(v.filas.map((f) => num(f.pesos)))] })), decision })
        }
        vs.forEach((v, i) => {
            const final = vs.length > 1 && decision === 'separar' && i > 0 ? `${clave}-${i + 1}` : clave
            for (const f of v.filas) claveFinal.set(f, final)
        })
    }

    const clavesFinales = [...new Set(claveFinal.values())]
    const matsBD = await Material.find().select('clave concepto costoUnitario costoUSD porValidar').lean()
    const porClaveBD = new Map(matsBD.map((m) => [m.clave.toUpperCase(), m]))
    const tokensBD = matsBD.map((m) => ({ m, t: tokens(m.concepto) }))

    const materiales: Analisis['materiales'] = clavesFinales.map((cf) => {
        const filas = todasFilas.filter((f) => claveFinal.get(f) === cf)
        const primera = filas[0]
        const precios = [...new Set(filas.map((f) => num(f.pesos)))]
        const pesos = moda(filas.map((f) => num(f.pesos)))
        const dolares = moda(filas.map((f) => num(f.dolares)))
        let tipo = String(primera.tipo ?? '').trim().toUpperCase()
        if (!cats.includes(tipo)) {
            avisos.push(`Material ${cf}: tipo "${primera.tipo || '(vacío)'}" no es una categoría configurada; se usó C.`)
            tipo = cats.includes('C') ? 'C' : cats[0]
        }
        const ex = porClaveBD.get(cf)
        const d = dec.materiales?.[cf]
        const t = tokens(primera.concepto)
        const parecidos = ex
            ? []
            : tokensBD
                  .map(({ m, t: tm }) => ({ id: String(m._id), clave: m.clave, concepto: m.concepto, similitud: Math.round(similitud(t, tm) * 100) / 100 }))
                  .filter((p) => p.similitud >= 0.75)
                  .sort((a, b) => b.similitud - a.similitud)
                  .slice(0, 3)
        const vincularValido = !!(d?.accion === 'vincular' && d.id && matsBD.some((m) => String(m._id) === d.id))
        const existente = ex
            ? { id: String(ex._id), concepto: ex.concepto, costoUnitario: ex.costoUnitario, costoUSD: ex.costoUSD, porValidar: !!ex.porValidar }
            : null
        return {
            clave: cf,
            claveArchivo: String(primera.clave).toUpperCase(),
            concepto: String(primera.concepto).trim(),
            proveedor: String(primera.proveedor ?? '').trim().toUpperCase() || 'PENDIENTE',
            tipo,
            unidad: unidadDe(primera.unidad),
            pesos,
            dolares,
            preciosArchivo: precios,
            usos: filas.length,
            estado: ex ? ('existe' as const) : ('nuevo' as const),
            existente,
            conceptoDistinto: !!ex && norm(ex.concepto) !== norm(primera.concepto),
            precioDistinto: !!ex && (Math.abs(ex.costoUnitario - pesos) > 0.005 || Math.abs(ex.costoUSD - dolares) > 0.005),
            parecidos,
            accion: ex ? ('existe' as const) : vincularValido ? ('vincular' as const) : ('crear' as const),
            vinculadoA: vincularValido ? d!.id : undefined,
            actualizarPrecio: !!d?.actualizarPrecio,
        }
    })

    // ---- Componentes ----
    const compsBD = await Componente.find().select('concepto variaciones').lean()
    // Nombres sugeridos: si un nombre se repite en el archivo se distingue por su grupo o un número
    const repetidos = new Map<string, number>()
    for (const s of secciones) repetidos.set(norm(s.nombre), (repetidos.get(norm(s.nombre)) ?? 0) + 1)
    const usados = new Map<string, number>()
    // Catálogo "virtual": lo existente + lo que este mismo archivo va a crear antes (por orden)
    type Plan = { id: string; concepto: string; planeado: boolean; variaciones: { id: string; nombre: string; mats: Map<string, number> }[] }
    const planes: Plan[] = compsBD.map((c) => ({
        id: String(c._id),
        concepto: c.concepto,
        planeado: false,
        variaciones: (c.variaciones ?? []).map((v) => ({ id: String(v._id), nombre: v.nombre, mats: mapaVariacion((v.materiales ?? []).map((m) => ({ clave: m.clave, cantidad: m.cantidad }))) })),
    }))

    const sugeridos = new Set<string>()
    const componentes: Analisis['componentes'] = secciones.map((s) => {
        let sugerido = s.nombre
        if ((repetidos.get(norm(s.nombre)) ?? 0) > 1) {
            const n = (usados.get(norm(s.nombre)) ?? 0) + 1
            usados.set(norm(s.nombre), n)
            sugerido = s.grupo ? `${s.nombre} (${s.grupo})` : n > 1 ? `${s.nombre} ${n}` : s.nombre
        }
        // Que ningún nombre sugerido se repita dentro del archivo (p. ej. dos grupos "SistEléctrico")
        if (sugeridos.has(norm(sugerido))) {
            let k = 2
            while (sugeridos.has(norm(`${sugerido} ${k}`))) k++
            sugerido = `${sugerido} ${k}`
        }
        sugeridos.add(norm(sugerido))
        const d = dec.componentes?.[s.idx]
        const nombre = String(d?.nombre ?? sugerido).trim() || sugerido
        const mats = mapaVariacion(s.filas.map((f) => ({ clave: claveFinal.get(f)!, cantidad: f.cantidad })))
        const importe = s.filas.reduce((t, f) => t + num(f.cantidad) * num(f.pesos), 0)

        const plan = planes.find((p) => norm(p.concepto) === norm(nombre))
        let existente: Analisis['componentes'][number]['existente'] = null
        let accion: AccionComponente = 'crear'
        let variacionId: string | undefined
        let nombreVariacion = String(d?.nombreVariacion ?? '').trim()

        if (plan) {
            const vars = plan.variaciones.map((v) => {
                const dif = comparar(mats, v.mats)
                return { id: v.id, nombre: v.nombre, coincide: coincide(dif), diferencias: dif }
            })
            existente = { id: plan.id, concepto: plan.concepto, planeado: plan.planeado, variaciones: vars }
            const igual = vars.find((v) => v.coincide)
            // Por defecto: usar la variación idéntica; si ninguna coincide, agregar una variación nueva
            accion = d?.accion && d.accion !== 'crear' ? d.accion : igual ? 'usarVariacion' : 'nuevaVariacion'
            if (accion === 'usarVariacion') {
                variacionId = vars.some((v) => v.id === d?.variacionId) ? d!.variacionId : igual?.id
                if (!variacionId) bloqueos.push(`Componente "${nombre}": elige qué variación usar.`)
            }
            if (accion === 'nuevaVariacion') {
                nombreVariacion ||= arch.equipo.clave || `Variación ${plan.variaciones.length + 1}`
                if (plan.variaciones.some((v) => norm(v.nombre) === norm(nombreVariacion)))
                    bloqueos.push(`Componente "${nombre}": ya tiene una variación llamada "${nombreVariacion}".`)
                plan.variaciones.push({ id: `plan-${s.idx}`, nombre: nombreVariacion, mats })
            }
        } else {
            accion = d?.accion === 'omitir' ? 'omitir' : 'crear'
            nombreVariacion ||= 'Estándar'
            if (accion === 'crear')
                planes.push({ id: `plan-${s.idx}`, concepto: nombre, planeado: true, variaciones: [{ id: `plan-${s.idx}`, nombre: nombreVariacion, mats }] })
        }
        return { idx: s.idx, nombreArchivo: s.nombre, nombre, grupo: s.grupo, materiales: s.filas.length, importe, existente, accion, variacionId, nombreVariacion }
    })

    // ---- Equipo ----
    const nombreEquipo = String(dec.equipo?.nombre ?? (arch.equipo.clave || arch.equipo.nombre)).trim()
    const exEq = nombreEquipo ? await Equipo.findOne({ nombre: new RegExp(`^${nombreEquipo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('nombre lineas').lean() : null
    let accionEq: 'crear' | 'reemplazar' | null = 'crear'
    if (!nombreEquipo) bloqueos.push('El equipo necesita un nombre.')
    if (exEq) {
        accionEq = dec.equipo?.accion === 'reemplazar' ? 'reemplazar' : null
        if (!accionEq) bloqueos.push(`Ya existe un equipo llamado "${exEq.nombre}": elige reemplazar su composición o cambia el nombre.`)
    }

    // ---- Verificación de totales contra los que trae el Excel (IVA incluido) ----
    // El Excel suma en pesos: los precios en dólares los convierte con SU columna de paridad;
    // aquí se hace igual (o con el tipo de cambio vigente si el renglón no trae paridad).
    const tcVigente = await getTipoCambio()
    const verificacion = [...cats, 'total'].map((c) => {
        const importado = secciones
            .flatMap((s) => s.filas)
            .filter((f) => c === 'total' || String(f.tipo).trim().toUpperCase() === c)
            .reduce((t, f) => t + num(f.cantidad) * (num(f.pesos) + num(f.dolares) * (num(f.paridad) || tcVigente)), 0)
        const excel = arch.sumas?.[c]
        return { categoria: c, excel: excel === undefined ? null : excel, importado: Math.round(importado * 100) / 100 }
    })

    if (conflictos.length) avisos.push(`${conflictos.length} clave(s) del archivo se usan para materiales con conceptos distintos (revisa la pestaña Conflictos).`)
    if (secciones.length === 0) bloqueos.push('El archivo no tiene secciones con materiales.')

    return {
        equipo: {
            nombre: nombreEquipo,
            descripcion: String(dec.equipo?.descripcion ?? arch.equipo.nombre ?? '').trim(),
            clave: arch.equipo.clave,
            existente: exEq ? { id: String(exEq._id), nombre: exEq.nombre, lineas: exEq.lineas?.length ?? 0 } : null,
            accion: accionEq,
        },
        proveedores,
        materiales: materiales.sort((a, b) => a.clave.localeCompare(b.clave)),
        conflictos,
        componentes,
        unidades,
        verificacion,
        bloqueos,
        avisos,
        resumen: { secciones: secciones.length, grupos, renglones: todasFilas.length },
    }
}

// ===================================================================================
async function siguienteFolio() {
    const lotes = await ImportacionLote.find({ folio: /^IMP\d+$/ }).select('folio').lean()
    const max = lotes.reduce((m, l) => Math.max(m, parseInt(l.folio.slice(3), 10) || 0), 0)
    return `IMP${String(max + 1).padStart(4, '0')}`
}

export async function aplicarBOM(arch: ArchivoBOM, dec: Decisiones, usuario: string) {
    // Se vuelve a analizar con las decisiones finales: lo que se aplica es lo que se revisó
    const a = await analizarBOM(arch, dec)
    if (a.bloqueos.length) {
        const e = new Error('Hay pendientes por resolver antes de aplicar') as Error & { bloqueos?: string[] }
        e.bloqueos = a.bloqueos
        throw e
    }

    const lote = await ImportacionLote.create({ folio: await siguienteFolio(), archivo: arch.archivo, equipoNombre: a.equipo.nombre, usuario })
    try {
        // 1. Unidades nuevas → catálogo de Configuración
        const nuevas = [...new Set(a.unidades.filter((u) => u.nueva).map((u) => u.catalogo))]
        if (nuevas.length) {
            const cfg = await getConfiguracion()
            cfg.unidades = [...(cfg.unidades ?? []), ...nuevas]
            await cfg.save()
            lote.unidadesAgregadas = nuevas
        }

        // 2. Proveedores
        const idProv = new Map<string, Types.ObjectId>()
        const provNuevos = a.proveedores.filter((p) => p.accion === 'crear')
        if (provNuevos.length) {
            const creados = await Proveedor.insertMany(
                provNuevos.map((p) => ({ codigo: p.codigo, razonSocial: `${p.codigo} (datos por completar)`, porValidar: true, lote: lote._id }))
            )
            creados.forEach((c) => idProv.set(c.codigo.toUpperCase(), c._id as Types.ObjectId))
            lote.creados.proveedores = creados.map((c) => c._id as Types.ObjectId)
        }
        for (const p of a.proveedores) if (p.id) idProv.set(p.codigo, new Types.ObjectId(p.id))
        const provSnap = new Map(
            (await Proveedor.find({ _id: { $in: [...idProv.values()] } }).select('codigo razonSocial').lean()).map((p) => [String(p._id), p])
        )

        // 3. Materiales
        const idMat = new Map<string, Types.ObjectId>()
        const nuevos = a.materiales.filter((m) => m.accion === 'crear')
        if (nuevos.length) {
            const creados = await Material.insertMany(
                nuevos.map((m) => {
                    const moneda = m.dolares > 0 && m.pesos > 0 ? 'ambos' : m.dolares > 0 ? 'usd' : 'mxn'
                    return {
                        clave: m.clave,
                        concepto: m.concepto,
                        categoriaPrincipal: m.tipo,
                        proveedorPrincipal: idProv.get(m.proveedor),
                        moneda,
                        monedaPrincipal: moneda === 'usd' ? 'usd' : 'mxn',
                        costoUnitario: m.pesos,
                        costoUSD: m.dolares,
                        importeMXN: m.pesos,
                        importeUSD: m.dolares,
                        porValidar: true,
                        lote: lote._id,
                    }
                })
            )
            creados.forEach((c) => idMat.set(c.clave.toUpperCase(), c._id as Types.ObjectId))
            lote.creados.materiales = creados.map((c) => c._id as Types.ObjectId)
        }
        for (const m of a.materiales) {
            if (m.accion === 'existe' && m.existente) {
                idMat.set(m.clave, new Types.ObjectId(m.existente.id))
                if (m.actualizarPrecio && m.precioDistinto) {
                    lote.preciosAntes.push({ material: new Types.ObjectId(m.existente.id), costoUnitario: m.existente.costoUnitario, costoUSD: m.existente.costoUSD })
                    await Material.updateOne({ _id: m.existente.id }, { costoUnitario: m.pesos, costoUSD: m.dolares, importeMXN: m.pesos, importeUSD: m.dolares })
                    await sincComponentesDesdeMaterial(m.existente.id, m.pesos, m.dolares)
                }
            }
            if (m.accion === 'vincular' && m.vinculadoA) idMat.set(m.clave, new Types.ObjectId(m.vinculadoA))
        }
        await lote.save()
        const matInfo = new Map(
            (await Material.find({ _id: { $in: [...idMat.values()] } }).select('clave concepto proveedorPrincipal monedaPrincipal').lean()).map((m) => [String(m._id), m])
        )

        // 4. Componentes y líneas del equipo (en el orden del archivo)
        const claveFinalDe = clavesFinalesPorFila(arch, dec)
        const catalogoUnidades = await getUnidades() // ya incluye las unidades nuevas del paso 1
        const lineas = new Map<string, { componente: Types.ObjectId; variacion: Types.ObjectId; cantidad: number }>()
        const creadosPorNombre = new Map<string, Types.ObjectId>()
        for (const c of a.componentes) {
            if (c.accion === 'omitir') continue
            const seccion = arch.secciones[c.idx]
            const asignados = seccion.filas
                .filter((f) => String(f.clave ?? '').trim() || String(f.concepto ?? '').trim())
                .map((f) => {
                    const mid = idMat.get(claveFinalDe.get(f) ?? '')!
                    const info = matInfo.get(String(mid))
                    const prov = info ? provSnap.get(String(info.proveedorPrincipal)) : undefined
                    const usd = info?.monedaPrincipal === 'usd'
                    const costoMXN = usd ? 0 : num(f.pesos)
                    const costoUSD = usd ? num(f.dolares) : 0
                    const cantidad = num(f.cantidad)
                    return {
                        material: mid,
                        clave: info?.clave ?? '',
                        concepto: info?.concepto ?? String(f.concepto),
                        proveedor: { proveedor: info?.proveedorPrincipal, codigo: prov?.codigo ?? '', razonSocial: prov?.razonSocial ?? '' },
                        tipo: String(f.tipo).trim().toUpperCase() || 'C',
                        cantidad,
                        unidad: mapearUnidad(f.unidad, catalogoUnidades),
                        costoMXN,
                        costoUSD,
                        paridad: num(f.paridad), // referencia: TC con que el Excel convirtió (no se usa para calcular)
                        importeMXN: +(cantidad * costoMXN).toFixed(2),
                        importeUSD: +(cantidad * costoUSD).toFixed(2),
                    }
                })

            let compId: Types.ObjectId
            let varId: Types.ObjectId
            const yaCreado = creadosPorNombre.get(norm(c.nombre))
            if (c.accion === 'crear' && !yaCreado) {
                const nuevo = await Componente.create({
                    concepto: c.nombre,
                    descripcion: `Importado de ${arch.archivo}${c.grupo ? ` · ${c.grupo}` : ''}`,
                    variaciones: [{ nombre: c.nombreVariacion, materiales: asignados }],
                    porValidar: true,
                    lote: lote._id,
                })
                compId = nuevo._id as Types.ObjectId
                varId = nuevo.variaciones[0]._id as Types.ObjectId
                creadosPorNombre.set(norm(c.nombre), compId)
                lote.creados.componentes.push(compId)
            } else {
                // Componente existente (o creado antes en este mismo archivo)
                const id = c.existente?.planeado ? yaCreado ?? creadosPorNombre.get(norm(c.existente.concepto)) : c.existente?.id
                const comp = await Componente.findById(id)
                if (!comp) throw new Error(`No se encontró el componente "${c.nombre}"`)
                compId = comp._id as Types.ObjectId
                if (c.accion === 'nuevaVariacion' || (c.accion === 'crear' && yaCreado)) {
                    comp.variaciones.push({ nombre: c.nombreVariacion, materiales: asignados } as never)
                    await comp.save()
                    varId = comp.variaciones[comp.variaciones.length - 1]._id as Types.ObjectId
                    if (!lote.creados.componentes.some((x) => String(x) === String(compId)))
                        lote.variacionesAgregadas.push({ componente: compId, variacion: varId })
                } else {
                    // usarVariacion (puede ser una variación planeada en este archivo)
                    const v = comp.variaciones.find((x) => String(x._id) === c.variacionId) ??
                        comp.variaciones.find((x) => norm(x.nombre) === norm(c.existente?.variaciones.find((y) => y.id === c.variacionId)?.nombre ?? ''))
                    if (!v) throw new Error(`No se encontró la variación elegida de "${c.nombre}"`)
                    varId = v._id as Types.ObjectId
                }
            }
            // Secciones idénticas (mismo componente y variación) se suman en una sola línea
            const k = `${compId}|${varId}`
            const prev = lineas.get(k)
            if (prev) prev.cantidad++
            else lineas.set(k, { componente: compId, variacion: varId, cantidad: 1 })
        }
        await lote.save()

        // 5. Equipo
        let equipoId: Types.ObjectId
        if (a.equipo.accion === 'reemplazar' && a.equipo.existente) {
            const eq = await Equipo.findById(a.equipo.existente.id)
            if (!eq) throw new Error('El equipo a reemplazar ya no existe')
            lote.equipoReemplazado = { equipo: eq._id as Types.ObjectId, lineasAntes: eq.toObject().lineas }
            eq.lineas = [...lineas.values()] as never
            await eq.save()
            equipoId = eq._id as Types.ObjectId
        } else {
            const eq = await Equipo.create({
                nombre: a.equipo.nombre,
                tipo: '',
                descripcion: a.equipo.descripcion,
                lineas: [...lineas.values()],
                porValidar: true,
                lote: lote._id,
            })
            equipoId = eq._id as Types.ObjectId
            lote.creados.equipos.push(equipoId)
        }

        // 6. Cierre del lote + bitácora
        const cuenta = (acc: AccionComponente) => a.componentes.filter((c) => c.accion === acc).length
        lote.resumen = [
            `Equipo: ${a.equipo.nombre} (${a.equipo.accion === 'reemplazar' ? 'composición reemplazada' : 'nuevo'}) · ${lineas.size} línea(s)`,
            `Componentes: ${lote.creados.componentes.length} nuevo(s), ${cuenta('nuevaVariacion')} variación(es) nueva(s) en componentes existentes, ${cuenta('usarVariacion')} reutilizado(s) tal cual${cuenta('omitir') ? `, ${cuenta('omitir')} omitido(s)` : ''}`,
            `Materiales: ${lote.creados.materiales.length} nuevo(s), ${a.materiales.filter((m) => m.accion !== 'crear').length} existente(s)${lote.preciosAntes.length ? `, ${lote.preciosAntes.length} precio(s) actualizado(s)` : ''}`,
            `Proveedores: ${lote.creados.proveedores.length} nuevo(s), ${a.proveedores.length - lote.creados.proveedores.length} existente(s)`,
            ...(lote.unidadesAgregadas.length ? [`Unidades agregadas: ${lote.unidadesAgregadas.join(', ')}`] : []),
        ]
        lote.estado = 'aplicado'
        await lote.save()
        await registrarHistorial({
            usuario,
            tipo: 'importacion',
            sector: 'bom',
            accion: 'importo',
            entidad: `${lote.folio} · ${a.equipo.nombre}`,
            equipo: equipoId as never,
            equipoNombre: a.equipo.nombre,
            cambios: [`Archivo: ${arch.archivo}`, ...lote.resumen, 'Lo nuevo quedó marcado "por validar" en los catálogos'],
            sensible: true,
        })
        return { lote, equipoId: String(equipoId) }
    } catch (error) {
        // Revertir lo que se alcanzó a crear (sin las guardas de uso: nadie lo ha usado aún)
        await revertir(lote, true).catch(() => undefined)
        lote.estado = 'fallido'
        await lote.save().catch(() => undefined)
        throw error
    }
}

// Clave final de cada fila del archivo (misma regla de separar/unificar que el análisis)
function clavesFinalesPorFila(arch: ArchivoBOM, dec: Decisiones) {
    const out = new Map<FilaBOM, string>()
    const porClave = new Map<string, { concepto: string; filas: FilaBOM[] }[]>()
    for (const s of arch.secciones)
        for (const f of s.filas ?? []) {
            if (!String(f.clave ?? '').trim() && !String(f.concepto ?? '').trim()) continue
            const clave = String(f.clave).trim().toUpperCase()
            const vs = porClave.get(clave) ?? []
            const v = vs.find((x) => norm(x.concepto) === norm(f.concepto))
            if (v) v.filas.push(f)
            else vs.push({ concepto: f.concepto, filas: [f] })
            porClave.set(clave, vs)
        }
    for (const [clave, vs] of porClave) {
        const separar = vs.length > 1 && (dec.conflictos?.[clave] ?? 'separar') === 'separar'
        vs.forEach((v, i) => v.filas.forEach((f) => out.set(f, separar && i > 0 ? `${clave}-${i + 1}` : clave)))
    }
    return out
}

// ===================================================================================
// Revisa si lo que creó el lote ya se usa fuera de él (entonces no se puede deshacer)
export async function bloqueosDeshacer(lote: IImportacionLote): Promise<string[]> {
    const b: string[] = []
    const eqLote = [...lote.creados.equipos, ...(lote.equipoReemplazado?.equipo ? [lote.equipoReemplazado.equipo] : [])]
    const compsLote = lote.creados.componentes
    const varsQuitadas = new Set(lote.variacionesAgregadas.map((v) => String(v.variacion)))

    for (const id of lote.creados.equipos)
        if (await Cotizacion.exists({ equipo: id })) b.push('El equipo importado ya tiene cotizaciones.')
    for (const id of compsLote) {
        const otro = await Equipo.findOne({ 'lineas.componente': id, _id: { $nin: eqLote } }).select('nombre').lean()
        if (otro) b.push(`Un componente importado ya se usa en el equipo "${otro.nombre}".`)
    }
    for (const v of lote.variacionesAgregadas) {
        const otro = await Equipo.findOne({ 'lineas.variacion': v.variacion, _id: { $nin: eqLote } }).select('nombre').lean()
        if (otro) b.push(`Una variación agregada por la importación ya se usa en el equipo "${otro.nombre}".`)
    }
    for (const id of lote.creados.materiales) {
        const comps = await Componente.find({ 'variaciones.materiales.material': id, _id: { $nin: compsLote } }).select('concepto variaciones').lean()
        const enUso = comps.find((c) => c.variaciones.some((v) => !varsQuitadas.has(String(v._id)) && v.materiales.some((m) => String(m.material) === String(id))))
        if (enUso) b.push(`Un material importado ya se usa en el componente "${enUso.concepto}".`)
        if (await Inventario.exists({ material: id })) b.push('Un material importado ya está en el inventario.')
        if (await OrdenCompra.exists({ 'items.material': id })) b.push('Un material importado ya está en una orden de compra.')
    }
    for (const id of lote.creados.proveedores) {
        if (await Material.exists({ $or: [{ proveedorPrincipal: id }, { proveedoresAsociados: id }], _id: { $nin: lote.creados.materiales } }))
            b.push('Un proveedor importado ya se asignó a otro material.')
        if (await OrdenCompra.exists({ proveedor: id })) b.push('Un proveedor importado ya tiene órdenes de compra.')
    }
    return [...new Set(b)]
}

async function revertir(lote: IImportacionLote, forzado = false) {
    if (!forzado) {
        const b = await bloqueosDeshacer(lote)
        if (b.length) {
            const e = new Error('No se puede deshacer: parte de lo importado ya se usa en el sistema') as Error & { bloqueos?: string[] }
            e.bloqueos = b
            throw e
        }
    }
    if (lote.equipoReemplazado?.equipo && lote.equipoReemplazado.lineasAntes)
        await Equipo.updateOne({ _id: lote.equipoReemplazado.equipo }, { lineas: lote.equipoReemplazado.lineasAntes })
    if (lote.creados.equipos.length) await Equipo.deleteMany({ _id: { $in: lote.creados.equipos } })
    for (const v of lote.variacionesAgregadas)
        await Componente.updateOne({ _id: v.componente }, { $pull: { variaciones: { _id: v.variacion } } })
    if (lote.creados.componentes.length) await Componente.deleteMany({ _id: { $in: lote.creados.componentes } })
    for (const p of lote.preciosAntes) {
        await Material.updateOne({ _id: p.material }, { costoUnitario: p.costoUnitario, costoUSD: p.costoUSD, importeMXN: p.costoUnitario, importeUSD: p.costoUSD })
        await sincComponentesDesdeMaterial(p.material, p.costoUnitario, p.costoUSD)
    }
    if (lote.creados.materiales.length) await Material.deleteMany({ _id: { $in: lote.creados.materiales } })
    if (lote.creados.proveedores.length) await Proveedor.deleteMany({ _id: { $in: lote.creados.proveedores } })
    // Unidades que agregó el lote: se quitan del catálogo si ya ningún componente las usa
    if (lote.unidadesAgregadas.length) {
        const sinUso: string[] = []
        for (const u of lote.unidadesAgregadas) if (!(await Componente.exists({ 'variaciones.materiales.unidad': u }))) sinUso.push(u)
        if (sinUso.length) {
            const cfg = await getConfiguracion()
            cfg.unidades = (cfg.unidades ?? []).filter((u) => !sinUso.includes(u))
            await cfg.save()
        }
    }
}

export async function deshacerLote(id: string, usuario: string) {
    const lote = await ImportacionLote.findById(id)
    if (!lote) throw Object.assign(new Error('Lote no encontrado'), { status: 404 })
    if (lote.estado !== 'aplicado') throw Object.assign(new Error(`El lote está ${lote.estado}; solo se deshace un lote aplicado`), { status: 409 })
    await revertir(lote)
    lote.estado = 'deshecho'
    lote.deshechoPor = usuario
    lote.deshechoAt = new Date()
    await lote.save()
    await registrarHistorial({
        usuario,
        tipo: 'importacion',
        sector: 'bom',
        accion: 'elimino',
        entidad: `${lote.folio} · ${lote.equipoNombre}`,
        equipoNombre: lote.equipoNombre,
        cambios: ['Se DESHIZO la importación: se quitó todo lo que había creado y se restauró lo que había modificado', ...lote.resumen],
        sensible: true,
        critico: true,
    })
    return lote
}

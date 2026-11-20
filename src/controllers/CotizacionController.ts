import type { Request, Response } from 'express'
import { Types } from 'mongoose'
import Cotizacion, { ICotLinea } from '../models/Cotizacion'
import { leerPaginacion, regexBusqueda, respuestaPaginada } from '../helpers/paginacion'
import Equipo from '../models/Equipo'
import Componente from '../models/Componente'
import Inventario from '../models/Inventario'
import Material from '../models/Material'
import OrdenCompra from '../models/OrdenCompra'
import Proveedor from '../models/Proveedor'
import { getTipoCambio, getPrefijoFolio } from '../models/Configuracion'
import { getParidadVigente } from '../models/Paridad'
import { propagarCostoDesdeOrden } from '../services/sincronizarCostos'
import { registrarMovimiento } from '../services/kardex'
import { efectivo, mapaPrincipal, principalDe } from '../services/moneda'

// --- Folios ---
async function generarFolioCot() {
    const pref = await getPrefijoFolio('cotizacion')
    const cots = await Cotizacion.find({ folio: new RegExp(`^${pref}\\d+$`) }).select('folio')
    let max = 0
    for (const c of cots) {
        const n = parseInt(c.folio.slice(pref.length), 10)
        if (!isNaN(n) && n > max) max = n
    }
    return `${pref}${(max + 1).toString().padStart(4, '0')}`
}
async function generarFolioOrden() {
    const pref = await getPrefijoFolio('orden')
    const ordenes = await OrdenCompra.find({ folio: new RegExp(`^${pref}\\d+$`) }).select('folio')
    let max = 0
    for (const o of ordenes) {
        const n = parseInt(o.folio.slice(pref.length), 10)
        if (!isNaN(n) && n > max) max = n
    }
    return `${pref}${(max + 1).toString().padStart(4, '0')}`
}

// Construye el snapshot del BOM (o subconjunto) para la cotización
async function construirSnapshot(lineas: { componente: string; variacion: string; cantidad: number }[]): Promise<ICotLinea[]> {
    const ids = lineas.map((l) => l.componente)
    const comps = await Componente.find({ _id: { $in: ids } })
    const map = new Map(comps.map((c) => [String(c._id), c]))

    // Moneda principal de cada material (para costear en UNA sola moneda)
    const idsMat = comps.flatMap((c) => c.variaciones.flatMap((v) => v.materiales.map((m) => m.material)))
    const principal = await mapaPrincipal(idsMat)

    return lineas.map((l) => {
        const c = map.get(String(l.componente))
        const v = c?.variaciones.find((x) => String(x._id) === String(l.variacion))
        const factor = l.cantidad || 1
        const materiales = (v?.materiales ?? []).map((m) => {
            const p = m.material ? principal.get(String(m.material)) ?? 'mxn' : m.costoUSD > 0 && !m.costoMXN ? 'usd' : 'mxn'
            const ef = efectivo(p, m.costoMXN, m.costoUSD)
            const cant = m.cantidad * factor
            return {
                material: m.material,
                clave: m.clave,
                concepto: m.concepto,
                tipo: m.tipo,
                cantidad: cant,
                unidad: m.unidad,
                costoMXN: ef.mxn,
                costoUSD: ef.usd,
                importeMXN: +(ef.mxn * cant).toFixed(2),
                importeUSD: +(ef.usd * cant).toFixed(2),
            }
        })
        return {
            componente: l.componente as never,
            componenteConcepto: c?.concepto ?? '',
            variacion: l.variacion as never,
            variacionNombre: v?.nombre ?? '',
            cantidad: factor,
            materiales,
        }
    })
}

// Prioridad para elegir de qué orden tomar el costo real de un material.
const PRIORIDAD_ORDEN: Record<string, number> = { confirmada: 3, enviada: 2, borrador: 1 }

// Costo REAL por material para una cotización:
//  - si el material vino de una orden ligada a la cotización (aunque sea de un proveedor
//    ALTERNO / no principal, y aunque NO se haya actualizado el catálogo) → costo de esa orden.
//  - si no vino de ninguna orden (estaba en inventario) → costo ACTUAL del catálogo.
// Entre varias órdenes del mismo material gana la de mayor estado (confirmada > enviada > borrador)
// y, a igualdad, la más reciente.
export interface CostoRealInfo {
    costoRealMXN: number
    costoRealUSD: number
    fuente: 'orden' | 'catalogo'
    folio?: string
    proveedor?: string
    estado?: string
}
export async function mapaCostoReal(cotId: string, materialIds: string[]): Promise<Map<string, CostoRealInfo>> {
    const out = new Map<string, CostoRealInfo>()
    if (materialIds.length === 0) return out

    // Moneda principal de cada material (respaldo cuando la orden no trae moneda)
    const principal = await mapaPrincipal(materialIds)

    // Órdenes de esta cotización (no canceladas), de la más antigua a la más reciente.
    // Cada material se costea en UNA sola moneda: la de la orden (si la trae) o su principal.
    const ordenes = await OrdenCompra.find({ cotizacion: cotId, estado: { $ne: 'cancelada' } }).sort({ createdAt: 1 })
    const porOrden = new Map<string, { costoMXN: number; costoUSD: number; folio: string; proveedor: string; estado: string; p: number }>()
    for (const o of ordenes) {
        for (const it of o.items) {
            if (!it.material) continue
            const k = String(it.material)
            const p = PRIORIDAD_ORDEN[o.estado] ?? 0
            const prev = porOrden.get(k)
            if (!prev || p >= prev.p) {
                const moneda = it.moneda === 'usd' || it.moneda === 'mxn' ? it.moneda : principal.get(k) ?? 'mxn'
                const ef = efectivo(moneda, it.costoUnitario, it.costoUnitarioUSD ?? 0)
                porOrden.set(k, {
                    costoMXN: ef.mxn,
                    costoUSD: ef.usd,
                    folio: o.folio,
                    proveedor: o.proveedorSnap?.codigo ?? '',
                    estado: o.estado,
                    p,
                })
            }
        }
    }

    // Para los que NO tienen orden, usar el costo actual del catálogo (solo la moneda principal)
    const faltanCatalogo = materialIds.filter((k) => !porOrden.has(k))
    const mats = await Material.find({ _id: { $in: faltanCatalogo } }).select('moneda monedaPrincipal costoUnitario costoUSD')
    const catMap = new Map(
        mats.map((m) => {
            const ef = efectivo(principalDe(m), m.costoUnitario, m.costoUSD)
            return [String(m._id), ef]
        })
    )

    for (const k of materialIds) {
        const o = porOrden.get(k)
        if (o) {
            out.set(k, {
                costoRealMXN: o.costoMXN,
                costoRealUSD: o.costoUSD,
                fuente: 'orden',
                folio: o.folio,
                proveedor: o.proveedor,
                estado: o.estado,
            })
        } else if (catMap.has(k)) {
            const c = catMap.get(k)!
            out.set(k, { costoRealMXN: c.mxn, costoRealUSD: c.usd, fuente: 'catalogo' })
        }
        // Si el material ya no existe en el catálogo NO se agrega entrada: quien llama
        // cae de vuelta al costo del snapshot de la cotización (antes quedaba en $0).
    }
    return out
}

// Recalcula EN VIVO: agrega lo requerido por material, compara vs inventario
// y agrupa las órdenes sugeridas por proveedor principal.
async function computarDetalle(cot: { lineas: ICotLinea[] }, cotId?: string, tipoCambio = 0) {
    const agg = new Map<string, { material: unknown; clave: string; concepto: string; requerido: number; costoMXN: number; costoUSD: number }>()
    for (const l of cot.lineas) {
        for (const m of l.materiales) {
            if (!m.material) continue
            const k = String(m.material)
            if (!agg.has(k)) {
                agg.set(k, { material: m.material, clave: m.clave, concepto: m.concepto, requerido: 0, costoMXN: m.costoMXN, costoUSD: m.costoUSD })
            }
            agg.get(k)!.requerido += m.cantidad
        }
    }

    const ids = [...agg.keys()]
    const invs = await Inventario.find({ material: { $in: ids } })
    const invMap = new Map(invs.map((i) => [String(i.material), i.cantidad]))
    const mats = await Material.find({ _id: { $in: ids } }).populate('proveedorPrincipal', 'codigo razonSocial email')
    const matMap = new Map(mats.map((m) => [String(m._id), m]))

    const estados = new Map<string, { stock: number; estado: string; faltante: number }>()
    const grupos = new Map<string, { proveedor: unknown; codigo: string; razonSocial: string; email: string; items: { material: unknown; clave: string; concepto: string; cantidad: number; moneda: 'mxn' | 'usd'; costoUnitario: number; importe: number; costoUnitarioUSD: number; importeUSD: number }[] }>()
    const sinProveedor: string[] = []

    for (const [k, a] of agg) {
        const stock = invMap.get(k) ?? 0
        const faltante = Math.max(0, a.requerido - stock)
        let estado = 'completo'
        if (stock <= 0) estado = 'requerido'
        else if (faltante > 0) estado = 'faltante'
        estados.set(k, { stock, estado, faltante })

        if (faltante > 0) {
            const mat = matMap.get(k)
            const prov = mat?.proveedorPrincipal as unknown as { _id: unknown; codigo: string; razonSocial: string; email?: string } | undefined
            if (prov) {
                const pk = String(prov._id)
                if (!grupos.has(pk)) {
                    grupos.set(pk, { proveedor: prov._id, codigo: prov.codigo, razonSocial: prov.razonSocial, email: prov.email ?? '', items: [] })
                }
                // Se sugiere comprar en la moneda principal del material (una sola)
                const mp = mat ? principalDe(mat) : 'mxn'
                const ef = efectivo(mp, a.costoMXN, a.costoUSD)
                grupos.get(pk)!.items.push({
                    material: a.material,
                    clave: a.clave,
                    concepto: a.concepto,
                    cantidad: faltante,
                    moneda: mp,
                    costoUnitario: ef.mxn,
                    importe: +(faltante * ef.mxn).toFixed(2),
                    costoUnitarioUSD: ef.usd,
                    importeUSD: +(faltante * ef.usd).toFixed(2),
                })
            } else {
                sinProveedor.push(a.concepto)
            }
        }
    }

    // Costo real por material (orden ligada o catálogo). Solo si se conoce la cotización.
    const costoRealMap = cotId ? await mapaCostoReal(cotId, [...agg.keys()]) : new Map<string, CostoRealInfo>()

    let totalReal = 0
    let totalRealUSD = 0
    const lineasTabla = cot.lineas.map((l) => ({
        componente: l.componente,
        componenteConcepto: l.componenteConcepto,
        variacionNombre: l.variacionNombre,
        cantidad: l.cantidad,
        materiales: l.materiales.map((m) => {
            const k = m.material ? String(m.material) : ''
            const e = m.material ? estados.get(k) : undefined
            const real = k ? costoRealMap.get(k) : undefined
            const costoRealMXN = real ? real.costoRealMXN : m.costoMXN
            const costoRealUSD = real ? real.costoRealUSD : m.costoUSD
            const importeRealMXN = +(costoRealMXN * m.cantidad).toFixed(2)
            const importeRealUSD = +(costoRealUSD * m.cantidad).toFixed(2)
            totalReal += importeRealMXN
            totalRealUSD += importeRealUSD
            return {
                material: m.material,
                clave: m.clave,
                concepto: m.concepto,
                tipo: m.tipo,
                cantidad: m.cantidad,
                unidad: m.unidad,
                costoMXN: m.costoMXN,
                costoUSD: m.costoUSD,
                importeMXN: m.importeMXN,
                importeUSD: m.importeUSD,
                stock: e?.stock ?? 0,
                estadoStock: e?.estado ?? 'requerido',
                faltante: e?.faltante ?? m.cantidad,
                // Costo REAL de esta cotización (ambas monedas, independientes)
                costoRealMXN,
                importeRealMXN,
                costoRealUSD,
                importeRealUSD,
                fuenteCosto: real?.fuente ?? 'catalogo',
                fuenteFolio: real?.folio ?? '',
                fuenteProveedor: real?.proveedor ?? '',
            }
        }),
    }))

    const ordenesSugeridas = [...grupos.values()].map((g) => ({
        proveedor: g.proveedor,
        codigo: g.codigo,
        razonSocial: g.razonSocial,
        email: g.email,
        items: g.items,
        total: +g.items.reduce((s, i) => s + i.importe, 0).toFixed(2),
        totalUSD: +g.items.reduce((s, i) => s + i.importeUSD, 0).toFixed(2),
    }))

    // Totales consolidados: cada moneda es la suma de lo suyo MÁS la conversión de la otra,
    // usando el tipo de cambio (MXN por USD). Es el ÚNICO punto donde se convierte.
    const tc = tipoCambio > 0 ? tipoCambio : 0
    const subtotalMXN = +totalReal.toFixed(2) // pesos "puros" (materiales que juegan en MXN)
    const subtotalUSD = +totalRealUSD.toFixed(2) // dólares "puros"
    const totalConsolidadoMXN = +(subtotalMXN + subtotalUSD * tc).toFixed(2)
    const totalConsolidadoUSD = +(subtotalUSD + (tc > 0 ? subtotalMXN / tc : 0)).toFixed(2)

    return {
        lineasTabla,
        ordenesSugeridas,
        sinProveedor,
        totalReal: subtotalMXN,
        totalRealUSD: subtotalUSD,
        // Consolidado dual-moneda para la caja del total
        tipoCambio: tc,
        subtotalMXN,
        subtotalUSD,
        totalConsolidadoMXN,
        totalConsolidadoUSD,
    }
}

export class CotizacionController {
    static crearCotizacion = async (req: Request, res: Response) => {
        try {
            const { equipo, contexto, lineas } = req.body
            const eq = await Equipo.findById(equipo)
            if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' })

            // creación = todas las líneas; reparación = subconjunto recibido
            const fuente =
                contexto === 'reparacion' && Array.isArray(lineas) && lineas.length > 0
                    ? lineas
                    : eq.lineas.map((l) => ({ componente: String(l.componente), variacion: String(l.variacion), cantidad: l.cantidad }))

            const snapshot = await construirSnapshot(fuente)
            const costo = snapshot.reduce((s, l) => s + l.materiales.reduce((ss, m) => ss + m.importeMXN, 0), 0)

            // Congela el TC vigente al crear Y guarda la referencia al registro de paridad,
            // para que si luego editan ese valor del pasado, esta cotización se recalcule.
            const pv = await getParidadVigente()
            const cot = new Cotizacion({
                folio: await generarFolioCot(),
                equipo: eq.id,
                equipoNombre: eq.nombre,
                contexto: contexto === 'reparacion' ? 'reparacion' : 'creacion',
                lineas: snapshot,
                costoCotizacion: +costo.toFixed(2),
                tipoCambio: pv.valor,
                paridad: pv._id,
                creadoPor: req.usuario?.nombre ?? '',
            })
            await cot.save()
            res.status(201).json({ mensaje: 'Cotización creada', id: cot.id, folio: cot.folio })
        } catch (error) {
            res.status(500).json({ error: 'Error al crear la cotización' })
        }
    }

    // Listado de cotizaciones. Filtros opcionales (combinables):
    //   q (folio/equipo) · estado · contexto · paridad (id del registro de Paridad)
    //   tcMin / tcMax (tipo de cambio con que se convirtió) · desde / hasta (fecha AAAA-MM-DD)
    // Con ?pagina=N responde paginado; sin él, la lista completa (panel de inicio).
    // Solo se leen los campos de la tabla: el snapshot del BOM (pesado) no se carga.
    static obtenerCotizaciones = async (req: Request, res: Response) => {
        try {
            const f: Record<string, unknown> = {}
            const rx = regexBusqueda(req.query.q)
            if (rx) f.$or = [{ folio: rx }, { equipoNombre: rx }]
            if (['activa', 'surtida', 'cancelada'].includes(String(req.query.estado))) f.estado = String(req.query.estado)
            if (['creacion', 'reparacion'].includes(String(req.query.contexto))) f.contexto = String(req.query.contexto)
            if (req.query.paridad) {
                if (!Types.ObjectId.isValid(String(req.query.paridad)))
                    return res.status(400).json({ error: 'Registro de paridad no válido' })
                f.paridad = new Types.ObjectId(String(req.query.paridad))
            }
            const tc: Record<string, number> = {}
            if (req.query.tcMin !== undefined && req.query.tcMin !== '' && !isNaN(Number(req.query.tcMin))) tc.$gte = Number(req.query.tcMin)
            if (req.query.tcMax !== undefined && req.query.tcMax !== '' && !isNaN(Number(req.query.tcMax))) tc.$lte = Number(req.query.tcMax)
            if (Object.keys(tc).length) f.tipoCambio = tc
            const fecha: Record<string, Date> = {}
            const desde = new Date(`${String(req.query.desde ?? '')}T00:00:00`)
            const hasta = new Date(`${String(req.query.hasta ?? '')}T23:59:59.999`)
            if (req.query.desde && !isNaN(desde.getTime())) fecha.$gte = desde
            if (req.query.hasta && !isNaN(hasta.getTime())) fecha.$lte = hasta
            if (Object.keys(fecha).length) f.createdAt = fecha

            const p = leerPaginacion(req)
            let consulta = Cotizacion.find(f)
                .select('folio equipoNombre contexto costoCotizacion estado tipoCambio paridad createdAt')
                .sort({ createdAt: -1 })
                .lean()
            if (p) consulta = consulta.skip(p.saltar).limit(p.limite)
            const [cots, total] = await Promise.all([consulta, p ? Cotizacion.countDocuments(f) : Promise.resolve(0)])

            const items = cots.map((c) => ({
                _id: String(c._id),
                folio: c.folio,
                equipoNombre: c.equipoNombre,
                contexto: c.contexto,
                costoCotizacion: c.costoCotizacion,
                estado: c.estado,
                tipoCambio: c.tipoCambio ?? 0,
                paridad: c.paridad ? String(c.paridad) : null,
                createdAt: (c as unknown as { createdAt: Date }).createdAt,
            }))
            res.json(p ? respuestaPaginada(items, total, p) : items)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener las cotizaciones' })
        }
    }

    // Detalle con la tabla y las órdenes sugeridas recalculadas EN VIVO vs inventario
    static detalleCotizacion = async (req: Request, res: Response) => {
        try {
            const cot = await Cotizacion.findById(req.params.id)
            if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' })
            const plain = cot.toObject() as unknown as { lineas: ICotLinea[] }
            // TC efectivo: el congelado de la cotización o, si no tiene, el global vigente
            const tc = cot.tipoCambio && cot.tipoCambio > 0 ? cot.tipoCambio : await getTipoCambio()
            const detalle = await computarDetalle(plain, cot.id, tc)

            // órdenes ya registradas desde esta cotización
            const ordenes = await OrdenCompra.find({ cotizacion: cot.id }).select('folio proveedorSnap estado presupuestoEstimado')

            res.json({
                _id: cot.id,
                folio: cot.folio,
                equipoNombre: cot.equipoNombre,
                contexto: cot.contexto,
                costoCotizacion: cot.costoCotizacion,
                costoManualDefinido: cot.costoManualDefinido,
                estado: cot.estado,
                creadoPor: cot.creadoPor,
                surtidaPor: cot.surtidaPor,
                ...detalle,
                ordenesRegistradas: ordenes,
            })
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener el detalle' })
        }
    }

    // Registra órdenes borrador ligadas a la cotización (todas o solo un proveedor)
    static registrarOrdenes = async (req: Request, res: Response) => {
        try {
            const cot = await Cotizacion.findById(req.params.id)
            if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' })
            if (cot.estado !== 'activa') return res.status(409).json({ error: 'La cotización no está activa' })

            const plain = cot.toObject() as unknown as { lineas: ICotLinea[] }
            const { ordenesSugeridas } = await computarDetalle(plain)

            const soloProveedor: string | undefined = req.body?.proveedor
            const totalOverride: number | undefined = req.body?.presupuestoEstimado
            const objetivo = soloProveedor
                ? ordenesSugeridas.filter((o) => String(o.proveedor) === String(soloProveedor))
                : ordenesSugeridas

            if (objetivo.length === 0) {
                return res.status(400).json({ error: 'No hay materiales faltantes para ordenar' })
            }

            const creadas: string[] = []
            for (const sug of objetivo) {
                // Evita duplicar SOLO contra una orden PENDIENTE (borrador/enviada) a ese proveedor.
                // Si la previa quedó confirmada o cancelada y el material sigue faltante, se crea una nueva.
                const yaExiste = await OrdenCompra.findOne({
                    cotizacion: cot.id,
                    proveedor: sug.proveedor as never,
                    estado: { $in: ['borrador', 'enviada'] },
                })
                if (yaExiste) continue

                const prov = await Proveedor.findById(sug.proveedor as never)
                const orden = new OrdenCompra({
                    folio: await generarFolioOrden(),
                    proveedor: sug.proveedor,
                    proveedorSnap: {
                        proveedor: sug.proveedor,
                        codigo: prov?.codigo ?? sug.codigo,
                        razonSocial: prov?.razonSocial ?? sug.razonSocial,
                        rfc: prov?.rfc ?? '',
                        direccion: prov?.direccion ?? '',
                        email: prov?.email ?? sug.email,
                    },
                    items: sug.items.map((i) => ({
                        material: i.material,
                        clave: i.clave,
                        concepto: i.concepto,
                        cantidad: i.cantidad,
                        moneda: i.moneda,
                        costoUnitario: i.costoUnitario,
                        importe: i.importe,
                        costoUnitarioUSD: i.costoUnitarioUSD,
                        importeUSD: i.importeUSD,
                    })),
                    // Permite ajustar el total al registrar una orden específica
                    presupuestoEstimado:
                        soloProveedor && totalOverride !== undefined ? Number(totalOverride) : sug.total,
                    cotizacion: cot.id,
                    folioCotizacion: cot.folio,
                    creadoPor: req.usuario?.nombre ?? '',
                })
                await orden.save()
                creadas.push(orden.folio)
            }

            res.json({ mensaje: 'Órdenes registradas como borrador', ordenes: creadas })
        } catch (error) {
            res.status(500).json({ error: 'Error al registrar las órdenes' })
        }
    }

    // Declara la salida: solo si TODOS los materiales están completos en inventario.
    // Descuenta del stock las cantidades requeridas (kardex de salida) y marca 'surtida'.
    static declararSalida = async (req: Request, res: Response) => {
        try {
            const cot = await Cotizacion.findById(req.params.id)
            if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' })
            if (cot.estado !== 'activa') return res.status(409).json({ error: 'La cotización no está activa' })

            const plain = cot.toObject() as unknown as { lineas: ICotLinea[] }
            const { lineasTabla } = await computarDetalle(plain)
            const hayFaltantes = lineasTabla.some((l) => l.materiales.some((m) => m.estadoStock !== 'completo'))
            if (hayFaltantes) {
                return res.status(409).json({ error: 'Aún hay materiales faltantes; no se puede declarar la salida' })
            }

            // Agrega lo requerido por material y descuenta del inventario
            const agg = new Map<string, { cantidad: number; clave: string; concepto: string }>()
            for (const l of plain.lineas) {
                for (const m of l.materiales) {
                    if (!m.material) continue
                    const k = String(m.material)
                    const prev = agg.get(k)
                    if (prev) prev.cantidad += m.cantidad
                    else agg.set(k, { cantidad: m.cantidad, clave: m.clave, concepto: m.concepto })
                }
            }

            const quien = req.usuario?.nombre ?? 'Sistema'
            let descontados = 0
            for (const [k, info] of agg) {
                const inv = await Inventario.findOne({ material: k })
                if (inv) {
                    const saldoAnterior = inv.cantidad
                    inv.cantidad = Math.max(0, inv.cantidad - info.cantidad)
                    await inv.save()
                    descontados++
                    // Kárdex: SALIDA por la cotización
                    await registrarMovimiento({
                        material: k,
                        clave: info.clave,
                        concepto: info.concepto,
                        tipo: 'salida',
                        cantidad: info.cantidad,
                        saldoAnterior,
                        saldoNuevo: inv.cantidad,
                        documento: cot.folio,
                        motivo: `Salida por cotización ${cot.folio} (${cot.equipoNombre})`,
                        usuario: quien,
                    })
                }
            }

            cot.estado = 'surtida'
            cot.surtidaPor = quien
            await cot.save()
            res.json({ mensaje: 'Salida declarada, materiales descontados del inventario', materialesDescontados: descontados })
        } catch (error) {
            res.status(500).json({ error: 'Error al declarar la salida' })
        }
    }

    static actualizarCotizacion = async (req: Request, res: Response) => {
        try {
            const cot = await Cotizacion.findById(req.params.id)
            if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' })

            // Ajustar el tipo de cambio de ESTA cotización (solo mientras está activa)
            if (req.body.tipoCambio !== undefined) {
                if (cot.estado !== 'activa') {
                    return res.status(409).json({ error: 'Solo se puede cambiar el tipo de cambio de una cotización activa' })
                }
                const tc = Number(req.body.tipoCambio)
                if (isNaN(tc) || tc < 0) return res.status(400).json({ error: 'Tipo de cambio no válido' })
                cot.tipoCambio = tc
                await cot.save()
                return res.json({ mensaje: 'Tipo de cambio actualizado' })
            }

            // Volver a usar el costo calculado automáticamente (descarta el ajuste manual)
            if (req.body.usarCalculado === true) {
                cot.costoManualDefinido = false
                await cot.save()
                return res.json({ mensaje: 'Se usará el costo real calculado' })
            }

            // Fijar el costo real a mano: SOLO si ya no hay faltantes (todas las órdenes y
            // materiales requeridos están completos). Este valor gana sobre el calculado.
            if (req.body.costoCotizacion !== undefined) {
                const plain = cot.toObject() as unknown as { lineas: ICotLinea[] }
                const { lineasTabla } = await computarDetalle(plain, cot.id)
                const hayFaltantes = lineasTabla.some((l) => l.materiales.some((m) => m.estadoStock !== 'completo'))
                if (hayFaltantes && cot.estado === 'activa') {
                    return res.status(409).json({
                        error: 'No se puede fijar el costo manual mientras haya órdenes o materiales pendientes',
                    })
                }
                cot.costoCotizacion = Number(req.body.costoCotizacion)
                cot.costoManualDefinido = true
            }

            await cot.save()
            res.json({ mensaje: 'Cotización actualizada' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar la cotización' })
        }
    }

    // Edita inline (desde el detalle de la cotización) el costo de un material que
    // proviene del catálogo (estaba en inventario, sin orden). Actualiza el catálogo
    // maestro EN PARALELO (y lo propaga a los componentes que lo usan).
    static actualizarCostoMaterial = async (req: Request, res: Response) => {
        try {
            const cot = await Cotizacion.findById(req.params.id)
            if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' })

            const { material, costoMXN, costoUSD } = req.body
            if (!material) return res.status(400).json({ error: 'Material no válido' })

            const hayMXN = costoMXN !== undefined && !isNaN(Number(costoMXN))
            const hayUSD = costoUSD !== undefined && !isNaN(Number(costoUSD))
            if (!hayMXN && !hayUSD) {
                return res.status(400).json({ error: 'Indica al menos un costo (MXN o USD)' })
            }

            // Cada moneda se actualiza por separado; la que no venga se conserva
            await propagarCostoDesdeOrden(
                material,
                hayMXN ? Number(costoMXN) : undefined,
                hayUSD ? Number(costoUSD) : undefined
            )
            res.json({ mensaje: 'Costo del material actualizado en el catálogo' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el costo del material' })
        }
    }

    // Cancela la cotización y elimina sus órdenes que aún NO se realizaron (borrador).
    // Las enviadas/confirmadas se conservan.
    static cancelarCotizacion = async (req: Request, res: Response) => {
        try {
            const cot = await Cotizacion.findById(req.params.id)
            if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' })

            // Una cotización SURTIDA ya descontó el material del inventario: cancelarla
            // dejaría el stock descuadrado y haría inaccesible su reporte.
            if (cot.estado === 'surtida') {
                return res.status(409).json({
                    error: 'No se puede cancelar una cotización ya surtida: el material salió del inventario. Registra el reingreso en Inventario si hubo una devolución.',
                })
            }
            if (cot.estado === 'cancelada') {
                return res.status(409).json({ error: 'La cotización ya estaba cancelada' })
            }

            const borradores = await OrdenCompra.deleteMany({ cotizacion: cot.id, estado: 'borrador' })
            cot.estado = 'cancelada'
            await cot.save()

            res.json({ mensaje: 'Cotización cancelada', ordenesEliminadas: borradores.deletedCount ?? 0 })
        } catch (error) {
            res.status(500).json({ error: 'Error al cancelar la cotización' })
        }
    }
}

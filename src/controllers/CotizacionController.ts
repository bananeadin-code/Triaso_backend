import type { Request, Response } from 'express'
import Cotizacion, { ICotLinea } from '../models/Cotizacion'
import Equipo from '../models/Equipo'
import Componente from '../models/Componente'
import Inventario from '../models/Inventario'
import Material from '../models/Material'
import OrdenCompra from '../models/OrdenCompra'
import Proveedor from '../models/Proveedor'
import { propagarCostoDesdeOrden } from '../services/sincronizarCostos'

// --- Folios ---
async function generarFolioCot() {
    const cots = await Cotizacion.find({ folio: /^COT\d+$/ }).select('folio')
    let max = 0
    for (const c of cots) {
        const n = parseInt(c.folio.slice(3), 10)
        if (!isNaN(n) && n > max) max = n
    }
    return `COT${(max + 1).toString().padStart(4, '0')}`
}
async function generarFolioOrden() {
    const ordenes = await OrdenCompra.find({ folio: /^OC\d+$/ }).select('folio')
    let max = 0
    for (const o of ordenes) {
        const n = parseInt(o.folio.slice(2), 10)
        if (!isNaN(n) && n > max) max = n
    }
    return `OC${(max + 1).toString().padStart(4, '0')}`
}

// Construye el snapshot del BOM (o subconjunto) para la cotización
async function construirSnapshot(lineas: { componente: string; variacion: string; cantidad: number }[]): Promise<ICotLinea[]> {
    const ids = lineas.map((l) => l.componente)
    const comps = await Componente.find({ _id: { $in: ids } })
    const map = new Map(comps.map((c) => [String(c._id), c]))

    return lineas.map((l) => {
        const c = map.get(String(l.componente))
        const v = c?.variaciones.find((x) => String(x._id) === String(l.variacion))
        const factor = l.cantidad || 1
        const materiales = (v?.materiales ?? []).map((m) => ({
            material: m.material,
            clave: m.clave,
            concepto: m.concepto,
            tipo: m.tipo,
            cantidad: m.cantidad * factor,
            unidad: m.unidad,
            costoMXN: m.costoMXN,
            costoUSD: m.costoUSD,
            importeMXN: +(m.importeMXN * factor).toFixed(2),
            importeUSD: +(m.importeUSD * factor).toFixed(2),
        }))
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
    fuente: 'orden' | 'catalogo'
    folio?: string
    proveedor?: string
    estado?: string
}
export async function mapaCostoReal(cotId: string, materialIds: string[]): Promise<Map<string, CostoRealInfo>> {
    const out = new Map<string, CostoRealInfo>()
    if (materialIds.length === 0) return out

    // Órdenes de esta cotización (no canceladas), de la más antigua a la más reciente
    const ordenes = await OrdenCompra.find({ cotizacion: cotId, estado: { $ne: 'cancelada' } }).sort({ createdAt: 1 })
    const porOrden = new Map<string, { costo: number; folio: string; proveedor: string; estado: string; p: number }>()
    for (const o of ordenes) {
        for (const it of o.items) {
            if (!it.material) continue
            const k = String(it.material)
            const p = PRIORIDAD_ORDEN[o.estado] ?? 0
            const prev = porOrden.get(k)
            if (!prev || p >= prev.p) {
                porOrden.set(k, {
                    costo: it.costoUnitario,
                    folio: o.folio,
                    proveedor: o.proveedorSnap?.codigo ?? '',
                    estado: o.estado,
                    p,
                })
            }
        }
    }

    // Para los que NO tienen orden, usar el costo actual del catálogo
    const faltanCatalogo = materialIds.filter((k) => !porOrden.has(k))
    const mats = await Material.find({ _id: { $in: faltanCatalogo } }).select('costoUnitario')
    const catMap = new Map(mats.map((m) => [String(m._id), m.costoUnitario]))

    for (const k of materialIds) {
        const o = porOrden.get(k)
        if (o) out.set(k, { costoRealMXN: o.costo, fuente: 'orden', folio: o.folio, proveedor: o.proveedor, estado: o.estado })
        else out.set(k, { costoRealMXN: catMap.get(k) ?? 0, fuente: 'catalogo' })
    }
    return out
}

// Recalcula EN VIVO: agrega lo requerido por material, compara vs inventario
// y agrupa las órdenes sugeridas por proveedor principal.
async function computarDetalle(cot: { lineas: ICotLinea[] }, cotId?: string) {
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
    const grupos = new Map<string, { proveedor: unknown; codigo: string; razonSocial: string; email: string; items: { material: unknown; clave: string; concepto: string; cantidad: number; costoUnitario: number; importe: number }[] }>()
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
                grupos.get(pk)!.items.push({
                    material: a.material,
                    clave: a.clave,
                    concepto: a.concepto,
                    cantidad: faltante,
                    costoUnitario: a.costoMXN,
                    importe: +(faltante * a.costoMXN).toFixed(2),
                })
            } else {
                sinProveedor.push(a.concepto)
            }
        }
    }

    // Costo real por material (orden ligada o catálogo). Solo si se conoce la cotización.
    const costoRealMap = cotId ? await mapaCostoReal(cotId, [...agg.keys()]) : new Map<string, CostoRealInfo>()

    let totalReal = 0
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
            const importeRealMXN = +(costoRealMXN * m.cantidad).toFixed(2)
            totalReal += importeRealMXN
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
                // Costo REAL de esta cotización
                costoRealMXN,
                importeRealMXN,
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
    }))

    return { lineasTabla, ordenesSugeridas, sinProveedor, totalReal: +totalReal.toFixed(2) }
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

            const cot = new Cotizacion({
                folio: await generarFolioCot(),
                equipo: eq.id,
                equipoNombre: eq.nombre,
                contexto: contexto === 'reparacion' ? 'reparacion' : 'creacion',
                lineas: snapshot,
                costoCotizacion: +costo.toFixed(2),
            })
            await cot.save()
            res.status(201).json({ mensaje: 'Cotización creada', id: cot.id, folio: cot.folio })
        } catch (error) {
            res.status(500).json({ error: 'Error al crear la cotización' })
        }
    }

    static obtenerCotizaciones = async (req: Request, res: Response) => {
        try {
            const cots = await Cotizacion.find().sort({ createdAt: -1 })
            res.json(
                cots.map((c) => ({
                    _id: c.id,
                    folio: c.folio,
                    equipoNombre: c.equipoNombre,
                    contexto: c.contexto,
                    costoCotizacion: c.costoCotizacion,
                    estado: c.estado,
                    createdAt: c.get('createdAt'),
                }))
            )
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
            const detalle = await computarDetalle(plain, cot.id)

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
                        costoUnitario: i.costoUnitario,
                        importe: i.importe,
                    })),
                    // Permite ajustar el total al registrar una orden específica
                    presupuestoEstimado:
                        soloProveedor && totalOverride !== undefined ? Number(totalOverride) : sug.total,
                    cotizacion: cot.id,
                    folioCotizacion: cot.folio,
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
            const agg = new Map<string, number>()
            for (const l of plain.lineas) {
                for (const m of l.materiales) {
                    if (!m.material) continue
                    const k = String(m.material)
                    agg.set(k, (agg.get(k) ?? 0) + m.cantidad)
                }
            }

            let descontados = 0
            for (const [k, requerido] of agg) {
                const inv = await Inventario.findOne({ material: k })
                if (inv) {
                    inv.cantidad = Math.max(0, inv.cantidad - requerido)
                    await inv.save()
                    descontados++
                }
            }

            cot.estado = 'surtida'
            await cot.save()
            res.json({ mensaje: 'Salida declarada, materiales descontados del inventario', materialesDescontados: descontados })
        } catch (error) {
            res.status(500).json({ error: 'Error al declarar la salida' })
        }
    }

    // Limpia cotizaciones terminadas (surtidas/canceladas) con más de 90 días de antigüedad
    static limpiarTerminadas = async (req: Request, res: Response) => {
        try {
            const hace90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
            const r = await Cotizacion.deleteMany({
                estado: { $in: ['surtida', 'cancelada'] },
                updatedAt: { $lt: hace90 },
            })
            res.json({ mensaje: 'Cotizaciones terminadas (+90 días) eliminadas', eliminadas: r.deletedCount ?? 0 })
        } catch (error) {
            res.status(500).json({ error: 'Error al limpiar las cotizaciones' })
        }
    }

    // Elimina TODAS las cotizaciones canceladas (sin rango de días)
    static limpiarCanceladas = async (req: Request, res: Response) => {
        try {
            const r = await Cotizacion.deleteMany({ estado: 'cancelada' })
            res.json({ mensaje: 'Cotizaciones canceladas eliminadas', eliminadas: r.deletedCount ?? 0 })
        } catch (error) {
            res.status(500).json({ error: 'Error al limpiar las cotizaciones canceladas' })
        }
    }

    static actualizarCotizacion = async (req: Request, res: Response) => {
        try {
            const cot = await Cotizacion.findById(req.params.id)
            if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' })

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

            const { material, costoMXN } = req.body
            if (!material || costoMXN === undefined || isNaN(Number(costoMXN))) {
                return res.status(400).json({ error: 'Material o costo no válido' })
            }

            await propagarCostoDesdeOrden(material, Number(costoMXN))
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

            const borradores = await OrdenCompra.deleteMany({ cotizacion: cot.id, estado: 'borrador' })
            cot.estado = 'cancelada'
            await cot.save()

            res.json({ mensaje: 'Cotización cancelada', ordenesEliminadas: borradores.deletedCount ?? 0 })
        } catch (error) {
            res.status(500).json({ error: 'Error al cancelar la cotización' })
        }
    }
}

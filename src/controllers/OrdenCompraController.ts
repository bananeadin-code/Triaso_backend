import type { Request, Response } from 'express'
import { Types } from 'mongoose'
import OrdenCompra, { IOrdenItem } from '../models/OrdenCompra'
import Proveedor from '../models/Proveedor'
import Material from '../models/Material'
import Recomendacion from '../models/Recomendacion'
import Inventario from '../models/Inventario'
import { propagarCostoDesdeOrden } from '../services/sincronizarCostos'
import { equiposAfectadosPorMaterial, registrarHistorial } from '../services/historial'
import { generarTicketPDF } from '../services/ticketPDF'
import { enviarCorreoOrden } from '../services/email'

// Genera el siguiente folio (OC0001, OC0002…)
async function generarFolio() {
    const ordenes = await OrdenCompra.find({ folio: /^OC\d+$/ }).select('folio')
    let max = 0
    for (const o of ordenes) {
        const n = parseInt(o.folio.slice(2), 10)
        if (!isNaN(n) && n > max) max = n
    }
    return `OC${(max + 1).toString().padStart(4, '0')}`
}

// Normaliza los renglones: toma snapshots del catálogo y calcula importes.
async function normalizarItems(items: IOrdenItem[]): Promise<{ items: IOrdenItem[]; subtotal: number }> {
    if (!Array.isArray(items)) return { items: [], subtotal: 0 }

    const ids = items.map((i) => (i.material ? String(i.material) : '')).filter(Boolean)
    const materiales = await Material.find({ _id: { $in: ids } })
    const mapa = new Map(materiales.map((m) => [String(m._id), m]))

    let subtotal = 0
    const norm = items.map((i) => {
        const ref = i.material ? mapa.get(String(i.material)) : undefined
        const cantidad = Number(i.cantidad) || 0
        const costoUnitario = i.costoUnitario !== undefined ? Number(i.costoUnitario) : (ref?.costoUnitario ?? 0)
        const importe = +(cantidad * costoUnitario).toFixed(2)
        subtotal += importe
        return {
            ...(i._id ? { _id: i._id } : {}),
            material: i.material,
            clave: i.clave || ref?.clave || '',
            concepto: i.concepto || ref?.concepto || '',
            cantidad,
            costoUnitario,
            importe,
        }
    })
    return { items: norm, subtotal: +subtotal.toFixed(2) }
}

export class OrdenCompraController {
    static obtenerOrdenes = async (req: Request, res: Response) => {
        try {
            const ordenes = await OrdenCompra.find().sort({ createdAt: -1 })
            const lista = ordenes.map((o) => ({
                _id: o.id,
                folio: o.folio,
                proveedor: o.proveedorSnap?.codigo || '',
                razonSocial: o.proveedorSnap?.razonSocial || '',
                estado: o.estado,
                totalItems: o.items.length,
                presupuestoEstimado: o.presupuestoEstimado,
                costoRealTotal: o.costoRealTotal,
                correoEnviado: o.correoEnviado,
                folioCotizacion: o.folioCotizacion,
                createdAt: o.get('createdAt'),
            }))
            res.json(lista)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener las órdenes' })
        }
    }

    static obtenerOrdenPorId = async (req: Request, res: Response) => {
        try {
            const orden = await OrdenCompra.findById(req.params.id)
            if (!orden) return res.status(404).json({ error: 'Orden no encontrada' })
            res.json(orden)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener la orden' })
        }
    }

    static crearOrden = async (req: Request, res: Response) => {
        try {
            const { proveedor, items, presupuestoEstimado, notas, ordenOrigen } = req.body

            const prov = await Proveedor.findById(proveedor)
            if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' })

            const { items: itemsNorm, subtotal } = await normalizarItems(items)

            const orden = new OrdenCompra({
                folio: await generarFolio(),
                proveedor: prov.id,
                proveedorSnap: {
                    proveedor: prov.id,
                    codigo: prov.codigo,
                    razonSocial: prov.razonSocial,
                    rfc: prov.rfc ?? '',
                    direccion: prov.direccion ?? '',
                    email: prov.email ?? '',
                },
                items: itemsNorm,
                // El total estimado es editable; por defecto = suma de importes
                presupuestoEstimado: presupuestoEstimado !== undefined ? Number(presupuestoEstimado) : subtotal,
                notas: notas ?? '',
                ordenOrigen: ordenOrigen || undefined,
            })
            await orden.save()
            res.status(201).json({ mensaje: 'Orden creada', id: orden.id, folio: orden.folio })
        } catch (error) {
            res.status(500).json({ error: 'Error al crear la orden' })
        }
    }

    // Editar una orden. En borrador: materiales, total y notas.
    // En enviada: solo el total estimado (de lo que sí se surtirá) y notas.
    static actualizarOrden = async (req: Request, res: Response) => {
        try {
            const orden = await OrdenCompra.findById(req.params.id)
            if (!orden) return res.status(404).json({ error: 'Orden no encontrada' })
            if (orden.estado !== 'borrador' && orden.estado !== 'enviada') {
                return res.status(409).json({ error: 'Esta orden ya no se puede editar' })
            }

            const { items, presupuestoEstimado, notas, materialesGlobal } = req.body

            if (items !== undefined && orden.estado === 'borrador') {
                // En borrador se editan materiales, cantidades y costos
                const { items: itemsNorm, subtotal } = await normalizarItems(items)
                orden.items = itemsNorm
                if (presupuestoEstimado === undefined) orden.presupuestoEstimado = subtotal
            } else if (items !== undefined && orden.estado === 'enviada') {
                // En enviada SOLO se editan los costos de los materiales existentes (cantidades fijas)
                const costos = new Map((items as { material: string; costoUnitario: number }[]).map((i) => [String(i.material), Number(i.costoUnitario)]))
                let subtotal = 0
                orden.items = orden.items.map((it) => {
                    const nuevo = it.material && costos.has(String(it.material)) ? costos.get(String(it.material))! : it.costoUnitario
                    const importe = +(it.cantidad * nuevo).toFixed(2)
                    subtotal += importe
                    return {
                        material: it.material,
                        clave: it.clave,
                        concepto: it.concepto,
                        cantidad: it.cantidad,
                        costoUnitario: nuevo,
                        importe,
                    }
                }) as never
                if (presupuestoEstimado === undefined) orden.presupuestoEstimado = +subtotal.toFixed(2)
            }
            if (presupuestoEstimado !== undefined) orden.presupuestoEstimado = Number(presupuestoEstimado)
            if (notas !== undefined) orden.notas = notas

            await orden.save()

            // Propaga a todo el sistema los costos de los materiales seleccionados.
            // Esto significa que el costo cambió DEFINITIVAMENTE con el proveedor → queda en el historial.
            if (Array.isArray(materialesGlobal)) {
                for (const id of materialesGlobal) {
                    const it = orden.items.find((x) => String(x.material) === String(id))
                    if (!it) continue

                    const mat = await Material.findById(id).select('clave concepto costoUnitario')
                    const costoAnterior = mat?.costoUnitario ?? 0
                    await propagarCostoDesdeOrden(id, it.costoUnitario)

                    if (mat && costoAnterior !== it.costoUnitario) {
                        await registrarHistorial({
                            usuario: req.usuario?.nombre ?? 'Sistema',
                            tipo: 'material',
                            material: mat._id as never,
                            materialClave: mat.clave,
                            materialConcepto: mat.concepto,
                            equiposAfectados: await equiposAfectadosPorMaterial(id),
                            cambios: [
                                `Costo MXN: $${costoAnterior.toFixed(2)} → $${it.costoUnitario.toFixed(2)} · actualizado en todo el sistema desde la orden ${orden.folio} (${orden.proveedorSnap?.codigo ?? 'proveedor'})`,
                            ],
                            sensible: true,
                        })
                    }
                }
            }

            res.json({ mensaje: 'Orden actualizada' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar la orden' })
        }
    }

    // Marca faltantes en una orden enviada: reduce lo que sí se surtirá,
    // recalcula el total y genera recomendaciones a proveedores alternativos.
    static registrarFaltantes = async (req: Request, res: Response) => {
        try {
            const orden = await OrdenCompra.findById(req.params.id)
            if (!orden) return res.status(404).json({ error: 'Orden no encontrada' })
            if (orden.estado !== 'enviada') {
                return res.status(409).json({ error: 'Solo se marcan faltantes en órdenes enviadas' })
            }

            // faltantes: [{ material, cantidad }]
            const faltantesIn: { material: string; cantidad: number }[] = req.body.faltantes ?? []
            const mapaFalta = new Map(faltantesIn.map((f) => [String(f.material), Number(f.cantidad) || 0]))

            // Construye la lista de faltantes con snapshot y reduce los items de la orden
            const faltantesReg: { material?: Types.ObjectId; clave: string; concepto: string; cantidad: number }[] = []
            let subtotal = 0
            const itemsRestantes = orden.items
                .map((it) => {
                    const falta = mapaFalta.get(String(it.material)) ?? 0
                    const faltaReal = Math.min(falta, it.cantidad)
                    if (faltaReal > 0) {
                        faltantesReg.push({ material: it.material, clave: it.clave, concepto: it.concepto, cantidad: faltaReal })
                    }
                    const nuevaCant = it.cantidad - faltaReal
                    const importe = +(nuevaCant * it.costoUnitario).toFixed(2)
                    subtotal += importe
                    return { ...it, cantidad: nuevaCant, importe }
                })
                .filter((it) => it.cantidad > 0)

            orden.items = itemsRestantes as never
            orden.presupuestoEstimado = +subtotal.toFixed(2)
            orden.faltantes = faltantesReg as never
            await orden.save()

            // Genera recomendaciones agrupadas por proveedor alternativo
            const idsFalta = faltantesReg.map((f) => String(f.material))
            const materiales = await Material.find({ _id: { $in: idsFalta } }).populate(
                'proveedorPrincipal proveedoresAsociados',
                'codigo razonSocial email'
            )
            const matMap = new Map(materiales.map((m) => [String(m._id), m]))

            type ProvInfo = { _id: unknown; codigo: string; razonSocial: string; email: string }
            const grupos = new Map<string, { prov: ProvInfo; items: typeof faltantesReg }>()
            const sinAlternativa: string[] = []

            for (const f of faltantesReg) {
                const mat = matMap.get(String(f.material))
                if (!mat) continue
                const alternativos: ProvInfo[] = [
                    mat.proveedorPrincipal as unknown as ProvInfo,
                    ...((mat.proveedoresAsociados as unknown as ProvInfo[]) ?? []),
                ].filter((p) => p && String(p._id) !== String(orden.proveedor))

                if (alternativos.length === 0) {
                    sinAlternativa.push(f.concepto)
                    continue
                }
                for (const alt of alternativos) {
                    const key = String(alt._id)
                    if (!grupos.has(key)) grupos.set(key, { prov: alt, items: [] })
                    grupos.get(key)!.items.push(f)
                }
            }

            const recomendaciones = []
            for (const [, g] of grupos) {
                const rec = await Recomendacion.create({
                    ordenOrigen: orden.id,
                    folioOrigen: orden.folio,
                    proveedor: g.prov._id as never,
                    proveedorSnap: { codigo: g.prov.codigo, razonSocial: g.prov.razonSocial, email: g.prov.email ?? '' },
                    items: g.items,
                    estado: 'pendiente',
                })
                recomendaciones.push(rec)
            }

            res.json({
                mensaje: 'Faltantes registrados',
                recomendacionesGeneradas: recomendaciones.length,
                sinAlternativa,
                nuevoTotal: orden.presupuestoEstimado,
            })
        } catch (error) {
            res.status(500).json({ error: 'Error al registrar los faltantes' })
        }
    }

    // Confirmar recepción: fija el costo real, ajusta a lo recibido (solo reducir)
    // y SUMA el stock recibido al inventario (kardex de entrada).
    static confirmarRecepcion = async (req: Request, res: Response) => {
        try {
            const orden = await OrdenCompra.findById(req.params.id)
            if (!orden) return res.status(404).json({ error: 'Orden no encontrada' })
            if (orden.estado !== 'enviada') {
                return res.status(409).json({ error: 'Solo se confirman órdenes enviadas' })
            }

            // items recibidos: [{ material, cantidad }] (solo se permite reducir)
            const recibidos: { material: string; cantidad: number }[] = req.body.items ?? []
            const recibMap = new Map(recibidos.map((r) => [String(r.material), Number(r.cantidad) || 0]))

            let subtotal = 0
            const finales = orden.items
                .map((it) => {
                    const recibido = recibMap.has(String(it.material))
                        ? Math.min(recibMap.get(String(it.material))!, it.cantidad)
                        : it.cantidad
                    const importe = +(recibido * it.costoUnitario).toFixed(2)
                    subtotal += importe
                    // Construir explícito: el spread {...it} de un subdoc de Mongoose NO copia los campos
                    return {
                        material: it.material,
                        clave: it.clave,
                        concepto: it.concepto,
                        cantidad: recibido,
                        costoUnitario: it.costoUnitario,
                        importe,
                    }
                })
                .filter((it) => it.cantidad > 0)

            orden.items = finales as never
            orden.costoRealTotal =
                req.body.costoRealTotal !== undefined ? Number(req.body.costoRealTotal) : +subtotal.toFixed(2)
            orden.estado = 'confirmada'
            orden.confirmadaAt = new Date()
            await orden.save()

            // Kardex: suma el stock recibido al inventario
            let stockActualizado = 0
            for (const it of finales) {
                if (!it.material || it.cantidad <= 0) continue
                const inv = await Inventario.findOne({ material: it.material })
                if (inv) {
                    inv.cantidad += it.cantidad
                    await inv.save()
                } else {
                    await Inventario.create({ material: it.material, cantidad: it.cantidad, ubicacion: '' })
                }
                stockActualizado++
            }

            res.json({
                mensaje: 'Recepción confirmada',
                costoRealTotal: orden.costoRealTotal,
                materialesEnStock: stockActualizado,
            })
        } catch (error) {
            res.status(500).json({ error: 'Error al confirmar la recepción' })
        }
    }

    // ===== Recomendaciones (pestaña de pendientes) =====
    static listarRecomendaciones = async (req: Request, res: Response) => {
        try {
            const recs = await Recomendacion.find({ estado: 'pendiente' }).sort({ createdAt: -1 })
            res.json(recs)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener recomendaciones' })
        }
    }

    // Finaliza una recomendación creando una nueva orden (borrador) al proveedor alternativo
    static finalizarRecomendacion = async (req: Request, res: Response) => {
        try {
            const rec = await Recomendacion.findById(req.params.id)
            if (!rec) return res.status(404).json({ error: 'Recomendación no encontrada' })
            if (rec.estado !== 'pendiente') {
                return res.status(409).json({ error: 'La recomendación ya fue procesada' })
            }

            const prov = await Proveedor.findById(rec.proveedor)
            if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' })

            const { items: itemsNorm, subtotal } = await normalizarItems(
                rec.items.map((i) => ({ material: i.material, cantidad: i.cantidad })) as never
            )

            // Hereda el contexto de cotización de la orden de la que se derivó (si tiene)
            const ordenOrigen = await OrdenCompra.findById(rec.ordenOrigen).select('cotizacion folioCotizacion')

            const orden = new OrdenCompra({
                folio: await generarFolio(),
                proveedor: prov.id,
                proveedorSnap: {
                    proveedor: prov.id,
                    codigo: prov.codigo,
                    razonSocial: prov.razonSocial,
                    rfc: prov.rfc ?? '',
                    direccion: prov.direccion ?? '',
                    email: prov.email ?? '',
                },
                items: itemsNorm,
                presupuestoEstimado: subtotal,
                ordenOrigen: rec.ordenOrigen,
                cotizacion: ordenOrigen?.cotizacion,
                folioCotizacion: ordenOrigen?.folioCotizacion ?? '',
            })
            await orden.save()

            rec.estado = 'finalizada'
            rec.ordenGenerada = orden._id as never
            await rec.save()

            res.json({ mensaje: 'Orden creada desde la recomendación', id: orden.id, folio: orden.folio })
        } catch (error) {
            res.status(500).json({ error: 'Error al finalizar la recomendación' })
        }
    }

    static eliminarRecomendacion = async (req: Request, res: Response) => {
        try {
            const rec = await Recomendacion.findById(req.params.id)
            if (!rec) return res.status(404).json({ error: 'Recomendación no encontrada' })
            rec.estado = 'eliminada'
            await rec.save()
            res.json({ mensaje: 'Recomendación descartada' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar la recomendación' })
        }
    }

    // Marca la orden como enviada; opcionalmente dispara el correo al proveedor.
    static marcarEnviada = async (req: Request, res: Response) => {
        try {
            const orden = await OrdenCompra.findById(req.params.id)
            if (!orden) return res.status(404).json({ error: 'Orden no encontrada' })
            if (orden.estado !== 'borrador') {
                return res.status(409).json({ error: 'Solo se pueden enviar órdenes en borrador' })
            }
            if (orden.items.length === 0) {
                return res.status(400).json({ error: 'La orden no tiene materiales' })
            }

            orden.estado = 'enviada'
            orden.enviadaAt = new Date()

            // correo: 'no_solicitado' | 'enviado' | 'sin_correo' | 'sin_credenciales' | 'error_envio'
            let correo = 'no_solicitado'
            if (req.body?.enviarCorreo) {
                const email = orden.proveedorSnap?.email
                if (!email) {
                    correo = 'sin_correo'
                } else {
                    try {
                        const pdf = await generarTicketPDF(orden)
                        await enviarCorreoOrden({ to: email, folio: orden.folio, pdf })
                        orden.correoEnviado = true
                        correo = 'enviado'
                    } catch (e) {
                        correo = e instanceof Error && e.message === 'SIN_CREDENCIALES' ? 'sin_credenciales' : 'error_envio'
                    }
                }
            }

            await orden.save()
            res.json({ mensaje: 'Orden marcada como enviada', correo })
        } catch (error) {
            res.status(500).json({ error: 'Error al enviar la orden' })
        }
    }

    // Descarga el ticket/factura de la orden en PDF (sin costos)
    static descargarPDF = async (req: Request, res: Response) => {
        try {
            const orden = await OrdenCompra.findById(req.params.id)
            if (!orden) return res.status(404).json({ error: 'Orden no encontrada' })
            const pdf = await generarTicketPDF(orden)
            res.setHeader('Content-Type', 'application/pdf')
            res.setHeader('Content-Disposition', `attachment; filename="${orden.folio}.pdf"`)
            res.send(pdf)
        } catch (error) {
            res.status(500).json({ error: 'Error al generar el PDF' })
        }
    }

    // Limpia órdenes completadas (confirmadas) con más de 90 días de antigüedad
    static limpiarCompletadas = async (req: Request, res: Response) => {
        try {
            const hace90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
            const r = await OrdenCompra.deleteMany({ estado: 'confirmada', confirmadaAt: { $lt: hace90 } })
            res.json({ mensaje: 'Órdenes completadas (+90 días) eliminadas', eliminadas: r.deletedCount ?? 0 })
        } catch (error) {
            res.status(500).json({ error: 'Error al limpiar las órdenes' })
        }
    }

    static eliminarOrden = async (req: Request, res: Response) => {
        try {
            const orden = await OrdenCompra.findById(req.params.id)
            if (!orden) return res.status(404).json({ error: 'Orden no encontrada' })
            if (orden.estado === 'confirmada') {
                return res.status(409).json({ error: 'No se puede eliminar una orden confirmada' })
            }
            await orden.deleteOne()
            res.json({ mensaje: 'Orden eliminada' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar la orden' })
        }
    }
}

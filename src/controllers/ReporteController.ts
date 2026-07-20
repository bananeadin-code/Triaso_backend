import type { Request, Response } from 'express'
import Inventario from '../models/Inventario'
import Material from '../models/Material'
import Proveedor from '../models/Proveedor'
import OrdenCompra from '../models/OrdenCompra'
import Equipo from '../models/Equipo'
import Cotizacion from '../models/Cotizacion'
import { construirBOM } from './EquipoController'
import { mapaCostoReal } from './CotizacionController'
import {
    money,
    reporteCotizacion,
    reporteEquipoBOM,
    reporteInventario,
    reporteMateriales,
    reporteOrdenes,
    reporteProveedores,
} from '../services/reportePDF'

function enviarPDF(res: Response, buf: Buffer, filename: string) {
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buf)
}

const EST_ORDEN: Record<string, string> = {
    borrador: 'Borrador',
    enviada: 'Enviada',
    confirmada: 'Confirmada',
    cancelada: 'Cancelada',
}

export class ReporteController {
    static inventario = async (req: Request, res: Response) => {
        try {
            const items = await Inventario.find().populate('material', 'clave concepto categoriaPrincipal')
            const filas = items
                .map((i) => {
                    const m = i.material as unknown as { clave?: string; concepto?: string; categoriaPrincipal?: string }
                    return {
                        clave: m?.clave ?? '—',
                        concepto: m?.concepto ?? '—',
                        categoria: m?.categoriaPrincipal ?? '',
                        stock: i.cantidad,
                        ubicacion: i.ubicacion || '—',
                    }
                })
                .sort((a, b) => a.clave.localeCompare(b.clave))
            enviarPDF(res, await reporteInventario(filas), 'inventario-triaso.pdf')
        } catch (error) {
            res.status(500).json({ error: 'Error al generar el reporte' })
        }
    }

    static materiales = async (req: Request, res: Response) => {
        try {
            const mats = await Material.find().populate('proveedorPrincipal', 'codigo').sort({ clave: 1 })
            const filas = mats.map((m) => {
                const p = m.proveedorPrincipal as unknown as { codigo?: string }
                return {
                    clave: m.clave,
                    concepto: m.concepto,
                    categoria: m.categoriaPrincipal,
                    proveedor: p?.codigo ?? '—',
                    costo: money(m.costoUnitario),
                }
            })
            enviarPDF(res, await reporteMateriales(filas), 'catalogo-materiales-triaso.pdf')
        } catch (error) {
            res.status(500).json({ error: 'Error al generar el reporte' })
        }
    }

    static proveedores = async (req: Request, res: Response) => {
        try {
            const provs = await Proveedor.find().sort({ codigo: 1 })
            const filas = provs.map((p) => ({
                codigo: p.codigo,
                razonSocial: p.razonSocial,
                rfc: p.rfc || '—',
                telefono: p.telefono || '—',
                email: p.email || '—',
            }))
            enviarPDF(res, await reporteProveedores(filas), 'proveedores-triaso.pdf')
        } catch (error) {
            res.status(500).json({ error: 'Error al generar el reporte' })
        }
    }

    static ordenes = async (req: Request, res: Response) => {
        try {
            const ordenes = await OrdenCompra.find().sort({ createdAt: -1 })
            const filas = ordenes.map((o) => ({
                folio: o.folio,
                proveedor: o.proveedorSnap?.codigo || '—',
                contexto: o.folioCotizacion ? `de ${o.folioCotizacion}` : 'Directa',
                estado: EST_ORDEN[o.estado] ?? o.estado,
                items: o.items.length,
                total: money(o.estado === 'confirmada' ? o.costoRealTotal : o.presupuestoEstimado),
            }))
            enviarPDF(res, await reporteOrdenes(filas), 'ordenes-compra-triaso.pdf')
        } catch (error) {
            res.status(500).json({ error: 'Error al generar el reporte' })
        }
    }

    static equipo = async (req: Request, res: Response) => {
        try {
            const equipo = await Equipo.findById(req.params.id)
            if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' })
            const bom = await construirBOM(equipo)
            const buf = await reporteEquipoBOM(equipo.nombre, equipo.tipo, bom.lineas as never, bom.resumen as never)
            enviarPDF(res, buf, `BOM-${equipo.nombre}.pdf`)
        } catch (error) {
            res.status(500).json({ error: 'Error al generar el reporte' })
        }
    }

    static cotizacion = async (req: Request, res: Response) => {
        try {
            const cot = await Cotizacion.findById(req.params.id)
            if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' })
            if (cot.estado !== 'surtida') {
                return res.status(409).json({ error: 'El reporte solo está disponible cuando la cotización ya fue surtida (salida declarada)' })
            }

            // Costos REALES por material: orden ligada (aunque sea de proveedor alterno) o catálogo
            const ids = [
                ...new Set(
                    cot.lineas.flatMap((l) =>
                        l.materiales.map((m) => (m.material ? String(m.material) : '')).filter(Boolean)
                    )
                ),
            ]
            const real = await mapaCostoReal(cot.id, ids)

            let total = 0
            const lineas = cot.lineas.map((l) => ({
                componenteConcepto: l.componenteConcepto,
                variacionNombre: l.variacionNombre,
                cantidad: l.cantidad,
                materiales: l.materiales.map((m) => {
                    const r = m.material ? real.get(String(m.material)) : undefined
                    const costoMXN = r ? r.costoRealMXN : m.costoMXN
                    const importeMXN = +(costoMXN * m.cantidad).toFixed(2)
                    total += importeMXN
                    return {
                        clave: m.clave,
                        concepto: m.concepto,
                        tipo: m.tipo,
                        cantidad: m.cantidad,
                        costoMXN,
                        importeMXN,
                        importeUSD: m.importeUSD,
                        fuente: r?.fuente === 'orden' ? `${r.folio} · ${r.proveedor}` : 'Catálogo',
                    }
                }),
            }))

            // Si se fijó un costo real a mano antes de la salida, ese gana sobre el calculado
            const totalEfectivo = cot.costoManualDefinido ? cot.costoCotizacion : +total.toFixed(2)
            const buf = await reporteCotizacion(
                cot.folio,
                cot.equipoNombre,
                cot.contexto,
                lineas,
                totalEfectivo,
                cot.costoManualDefinido
            )
            enviarPDF(res, buf, `cotizacion-${cot.folio}.pdf`)
        } catch (error) {
            res.status(500).json({ error: 'Error al generar el reporte' })
        }
    }
}

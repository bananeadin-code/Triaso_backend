import type { Request, Response } from 'express'
import Paridad, { upsertParidadHoy } from '../models/Paridad'
import Cotizacion from '../models/Cotizacion'
import { getConfiguracion } from '../models/Configuracion'
import { fetchTipoCambioBanxico } from '../services/banxico'
import { registrarHistorial } from '../services/historial'

const fmt = (n: number) => `$${(n ?? 0).toFixed(2)}`

export class ParidadController {
    // Bitácora: registros del tipo de cambio, más recientes primero.
    static obtener = async (req: Request, res: Response) => {
        try {
            const registros = await Paridad.find().sort({ fecha: -1, createdAt: -1 }).limit(300)
            // Cuántas cotizaciones dependen de cada registro (para avisar antes de editar/borrar)
            const conteos = await Cotizacion.aggregate([
                { $match: { paridad: { $ne: null } } },
                { $group: { _id: '$paridad', n: { $sum: 1 } } },
            ])
            const mapa = new Map(conteos.map((c: { _id: unknown; n: number }) => [String(c._id), c.n]))
            res.json(registros.map((r) => ({ ...r.toObject(), cotizaciones: mapa.get(String(r._id)) ?? 0 })))
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener la bitácora de paridad' })
        }
    }

    // Agrega un registro al histórico (fecha opcional; por defecto hoy).
    static crear = async (req: Request, res: Response) => {
        try {
            const valor = Number(req.body.valor)
            if (isNaN(valor) || valor <= 0) return res.status(400).json({ error: 'Valor de paridad no válido' })
            const fecha = req.body.fecha ? new Date(req.body.fecha) : new Date()
            if (isNaN(fecha.getTime())) return res.status(400).json({ error: 'Fecha no válida' })

            const p = await Paridad.create({ valor, fecha, origen: 'manual', nota: String(req.body.nota ?? '').trim(), creadoPor: req.usuario?.nombre ?? 'Sistema' })
            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'sistema', sector: 'sistema', accion: 'creo', entidad: 'Paridad',
                cambios: [`Registro de paridad ${fmt(valor)} con fecha ${fecha.toLocaleDateString('es-MX')}`],
            })
            res.status(201).json({ mensaje: 'Registro de paridad creado', id: p.id })
        } catch (error) {
            res.status(500).json({ error: 'Error al crear el registro de paridad' })
        }
    }

    // Edita un registro. Si cambia el VALOR, re-propaga a las cotizaciones ligadas
    // (su conversión del pasado se actualiza, porque el total se calcula en vivo con su TC).
    static actualizar = async (req: Request, res: Response) => {
        try {
            const p = await Paridad.findById(req.params.id)
            if (!p) return res.status(404).json({ error: 'Registro no encontrado' })

            const valorAntes = p.valor
            const cambios: string[] = []
            if (req.body.valor !== undefined) {
                const v = Number(req.body.valor)
                if (isNaN(v) || v <= 0) return res.status(400).json({ error: 'Valor de paridad no válido' })
                if (v !== p.valor) cambios.push(`Valor: ${fmt(p.valor)} → ${fmt(v)}`)
                p.valor = v
            }
            if (req.body.fecha !== undefined) {
                const f = new Date(req.body.fecha)
                if (isNaN(f.getTime())) return res.status(400).json({ error: 'Fecha no válida' })
                p.fecha = f
            }
            if (req.body.nota !== undefined) p.nota = String(req.body.nota).trim()
            await p.save()

            // Propagación inteligente: actualizar el TC congelado de las cotizaciones ligadas
            let cotizacionesActualizadas = 0
            if (p.valor !== valorAntes) {
                const r = await Cotizacion.updateMany({ paridad: p._id }, { tipoCambio: p.valor })
                cotizacionesActualizadas = r.modifiedCount ?? 0
                cambios.push(`Re-propagado a ${cotizacionesActualizadas} cotización(es) ligada(s)`)
            }

            if (cambios.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'sistema', sector: 'sistema', accion: 'edito', entidad: 'Paridad',
                    cambios, sensible: cotizacionesActualizadas > 0,
                })
            }
            res.json({ mensaje: 'Registro actualizado', cotizacionesActualizadas })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el registro de paridad' })
        }
    }

    // Elimina un registro (bloquea si hay cotizaciones ligadas o si es el único).
    static eliminar = async (req: Request, res: Response) => {
        try {
            const p = await Paridad.findById(req.params.id)
            if (!p) return res.status(404).json({ error: 'Registro no encontrado' })

            const enUso = await Cotizacion.countDocuments({ paridad: p._id })
            if (enUso > 0) {
                return res.status(400).json({ error: `No se puede eliminar: ${enUso} cotización(es) usan este valor. Edítalo en lugar de borrarlo.` })
            }
            const total = await Paridad.countDocuments()
            if (total <= 1) return res.status(400).json({ error: 'Debe quedar al menos un registro de paridad' })

            await p.deleteOne()
            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'sistema', sector: 'sistema', accion: 'elimino', entidad: 'Paridad',
                cambios: [`Se eliminó el registro de ${fmt(p.valor)} (${p.fecha.toLocaleDateString('es-MX')})`],
            })
            res.json({ mensaje: 'Registro eliminado' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el registro de paridad' })
        }
    }

    // Trae el valor de hoy desde Banxico (una vez al día: actualiza el registro de hoy).
    static traerHoy = async (req: Request, res: Response) => {
        try {
            const cfg = await getConfiguracion()
            if (!cfg.banxicoToken) {
                return res.status(400).json({ error: 'Configura primero el token de Banxico en Configuración' })
            }
            const { valor, fecha } = await fetchTipoCambioBanxico(cfg.banxicoToken)
            const p = await upsertParidadHoy(valor, 'api', req.usuario?.nombre ?? 'Sistema', `Banxico FIX ${fecha}`)
            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'sistema', sector: 'sistema', accion: 'edito', entidad: 'Paridad',
                cambios: [`Tipo de cambio de hoy traído de Banxico: ${fmt(valor)}`],
            })
            res.json({ mensaje: `Tipo de cambio de hoy: ${fmt(valor)}`, valor: p.valor })
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : 'Error al consultar Banxico' })
        }
    }
}

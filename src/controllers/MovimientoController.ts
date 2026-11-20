import type { Request, Response } from 'express'
import MovimientoInventario from '../models/MovimientoInventario'

export class MovimientoController {
    // Lista los movimientos de kárdex (más recientes primero).
    // Filtros opcionales: ?material=<id> y ?tipo=entrada|salida|ajuste
    static obtener = async (req: Request, res: Response) => {
        try {
            const filtro: Record<string, unknown> = {}
            if (req.query.material) filtro.material = req.query.material
            if (req.query.tipo) filtro.tipo = req.query.tipo

            const movimientos = await MovimientoInventario.find(filtro).sort({ createdAt: -1 }).limit(300)
            res.json(movimientos)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener los movimientos' })
        }
    }
}

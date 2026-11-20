import type { Request, Response } from 'express'
import Historial, { SectorHistorial } from '../models/Historial'
import { MAX_POR_SECTOR } from '../services/historial'

const SECTORES = ['catalogos', 'bom', 'compras', 'inventario', 'sistema']

export class HistorialController {
    // Últimos registros, más recientes primero. Filtro opcional ?sector=
    static obtenerHistorial = async (req: Request, res: Response) => {
        try {
            const sector = String(req.query.sector ?? '')
            const filtro = SECTORES.includes(sector) ? { sector: sector as SectorHistorial } : {}
            // Por sector: 50; sin filtro: hasta 50 por cada uno de los sectores
            const limite = SECTORES.includes(sector) ? MAX_POR_SECTOR : MAX_POR_SECTOR * SECTORES.length
            const registros = await Historial.find(filtro).sort({ createdAt: -1 }).limit(limite)
            res.json(registros)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener el historial' })
        }
    }
    // Sin "limpiar": Triaso conserva su bitácora; solo se poda sola a 50 registros por sector.
}

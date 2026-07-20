import type { Request, Response } from 'express'
import Historial from '../models/Historial'
import { MAX_REGISTROS } from '../services/historial'

export class HistorialController {
    // Últimos registros más recientes primero
    static obtenerHistorial = async (req: Request, res: Response) => {
        try {
            const registros = await Historial.find().sort({ createdAt: -1 }).limit(MAX_REGISTROS)
            res.json(registros)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener el historial' })
        }
    }

    // Limpiar todo el historial (solo admin)
    static limpiarHistorial = async (req: Request, res: Response) => {
        try {
            await Historial.deleteMany({})
            res.json({ mensaje: 'Historial limpiado' })
        } catch (error) {
            res.status(500).json({ error: 'Error al limpiar el historial' })
        }
    }
}

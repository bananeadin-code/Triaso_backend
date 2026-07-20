import type { Request, Response } from 'express'
import Inventario from '../models/Inventario'
import Material from '../models/Material'

export class InventarioController {
    // Lista el inventario con los datos del material (clave, concepto)
    static obtenerInventario = async (req: Request, res: Response) => {
        try {
            const items = await Inventario.find().populate(
                'material',
                'clave concepto categoriaPrincipal costoUnitario'
            )
            // Ordena por clave del material
            items.sort((a, b) => {
                const ca = (a.material as unknown as { clave?: string })?.clave ?? ''
                const cb = (b.material as unknown as { clave?: string })?.clave ?? ''
                return ca.localeCompare(cb)
            })
            res.json(items)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener el inventario' })
        }
    }

    // Agrega un material del catálogo al inventario (carga inicial / sobrantes)
    static agregarAlInventario = async (req: Request, res: Response) => {
        try {
            const { material, cantidad, ubicacion } = req.body

            const existeMaterial = await Material.findById(material)
            if (!existeMaterial) {
                return res.status(404).json({ error: 'El material no existe en el catálogo' })
            }

            const yaEnInventario = await Inventario.findOne({ material })
            if (yaEnInventario) {
                return res.status(409).json({ error: 'Este material ya está en el inventario' })
            }

            const item = new Inventario({ material, cantidad, ubicacion })
            await item.save()
            res.status(201).json({ mensaje: 'Material agregado al inventario', id: item.id })
        } catch (error) {
            res.status(500).json({ error: 'Error al agregar al inventario' })
        }
    }

    // Actualiza stock y/o ubicación de un renglón del inventario
    static actualizarInventario = async (req: Request, res: Response) => {
        try {
            const item = await Inventario.findById(req.params.id)
            if (!item) {
                return res.status(404).json({ error: 'Renglón de inventario no encontrado' })
            }
            const { cantidad, ubicacion } = req.body
            if (cantidad !== undefined) item.cantidad = cantidad
            if (ubicacion !== undefined) item.ubicacion = ubicacion
            await item.save()
            res.json({ mensaje: 'Inventario actualizado' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el inventario' })
        }
    }

    // Quita un material del inventario
    static eliminarDelInventario = async (req: Request, res: Response) => {
        try {
            const item = await Inventario.findById(req.params.id)
            if (!item) {
                return res.status(404).json({ error: 'Renglón de inventario no encontrado' })
            }
            await item.deleteOne()
            res.json({ mensaje: 'Material quitado del inventario' })
        } catch (error) {
            res.status(500).json({ error: 'Error al quitar del inventario' })
        }
    }
}

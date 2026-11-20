import type { Request, Response } from 'express'
import Inventario from '../models/Inventario'
import Material from '../models/Material'
import { registrarMovimiento } from '../services/kardex'
import { limpiarPersonalizados } from '../services/camposPersonalizados'

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
            item.personalizados = await limpiarPersonalizados('inventario', req.body.personalizados)
            await item.save()

            const cant = Number(cantidad) || 0
            if (cant > 0) {
                await registrarMovimiento({
                    material: String(material),
                    clave: existeMaterial.clave,
                    concepto: existeMaterial.concepto,
                    tipo: 'entrada',
                    cantidad: cant,
                    saldoAnterior: 0,
                    saldoNuevo: cant,
                    documento: 'Carga inicial',
                    motivo: (req.body.motivo as string) || 'Carga inicial al inventario',
                    usuario: req.usuario?.nombre ?? 'Sistema',
                })
            }
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
            const saldoAnterior = item.cantidad
            if (cantidad !== undefined) item.cantidad = Number(cantidad)
            if (ubicacion !== undefined) item.ubicacion = ubicacion
            // Datos adicionales (informativos; se conservan los de campos ocultos)
            if (req.body.personalizados !== undefined) {
                item.personalizados = await limpiarPersonalizados('inventario', req.body.personalizados, item.personalizados)
                item.markModified('personalizados')
            }
            await item.save()

            // Kárdex: un ajuste MANUAL de stock deja rastro (quién y por qué).
            // Es la vía clásica de las "pérdidas silenciosas"; aquí queda auditada.
            const delta = item.cantidad - saldoAnterior
            if (cantidad !== undefined && delta !== 0) {
                await registrarMovimiento({
                    material: String(item.material),
                    tipo: 'ajuste',
                    cantidad: Math.abs(delta),
                    saldoAnterior,
                    saldoNuevo: item.cantidad,
                    documento: 'Ajuste manual',
                    motivo:
                        (req.body.motivo as string) ||
                        `Ajuste manual de stock (${delta > 0 ? '+' : ''}${delta})`,
                    usuario: req.usuario?.nombre ?? 'Sistema',
                })
            }
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

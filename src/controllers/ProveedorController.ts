import type { Request, Response } from 'express'
import Proveedor from '../models/Proveedor'
import Material from '../models/Material'

export class ProveedorController {
    // Listar proveedores
    static obtenerProveedores = async (req: Request, res: Response) => {
        try {
            const proveedores = await Proveedor.find().sort({ codigo: 1 })
            res.json(proveedores)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener proveedores' })
        }
    }

    // Detalle de un proveedor con sus materiales asociados (concepto + costo)
    static obtenerProveedorPorId = async (req: Request, res: Response) => {
        try {
            const proveedor = await Proveedor.findById(req.params.id)
            if (!proveedor) {
                return res.status(404).json({ error: 'Proveedor no encontrado' })
            }

            // Materiales donde este proveedor es principal o está asociado
            const materiales = await Material.find({
                $or: [{ proveedorPrincipal: proveedor.id }, { proveedoresAsociados: proveedor.id }],
            }).select('clave concepto costoUnitario categoriaPrincipal')

            res.json({ proveedor, materiales })
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener el proveedor' })
        }
    }

    // Crear proveedor
    static crearProveedor = async (req: Request, res: Response) => {
        try {
            const codigo = String(req.body.codigo).toUpperCase().trim()
            const existe = await Proveedor.findOne({ codigo })
            if (existe) {
                return res.status(409).json({ error: `Ya existe un proveedor con el código ${codigo}` })
            }
            const proveedor = new Proveedor(req.body)
            await proveedor.save()
            res.status(201).json({ mensaje: 'Proveedor creado correctamente', id: proveedor.id })
        } catch (error) {
            res.status(500).json({ error: 'Error al crear el proveedor' })
        }
    }

    // Actualizar proveedor
    static actualizarProveedor = async (req: Request, res: Response) => {
        try {
            const proveedor = await Proveedor.findById(req.params.id)
            if (!proveedor) {
                return res.status(404).json({ error: 'Proveedor no encontrado' })
            }

            // Si cambian el código, verificar que no choque con otro
            if (req.body.codigo) {
                const codigo = String(req.body.codigo).toUpperCase().trim()
                const otro = await Proveedor.findOne({ codigo, _id: { $ne: proveedor.id } })
                if (otro) {
                    return res.status(409).json({ error: `Ya existe otro proveedor con el código ${codigo}` })
                }
            }

            Object.assign(proveedor, req.body)
            await proveedor.save()
            res.json({ mensaje: 'Proveedor actualizado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el proveedor' })
        }
    }

    // Eliminar proveedor (bloquea si tiene materiales asociados)
    static eliminarProveedor = async (req: Request, res: Response) => {
        try {
            const proveedor = await Proveedor.findById(req.params.id)
            if (!proveedor) {
                return res.status(404).json({ error: 'Proveedor no encontrado' })
            }

            const enUso = await Material.countDocuments({
                $or: [{ proveedorPrincipal: proveedor.id }, { proveedoresAsociados: proveedor.id }],
            })
            if (enUso > 0) {
                return res.status(409).json({
                    error: `No se puede eliminar: el proveedor está asociado a ${enUso} material(es)`,
                })
            }

            await proveedor.deleteOne()
            res.json({ mensaje: 'Proveedor eliminado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el proveedor' })
        }
    }
}

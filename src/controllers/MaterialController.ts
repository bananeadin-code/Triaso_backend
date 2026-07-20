import type { Request, Response } from 'express'
import Material from '../models/Material'
import { CATEGORIAS, getCategoria } from '../config/categorias'
import { sincComponentesDesdeMaterial } from '../services/sincronizarCostos'
import { equiposAfectadosPorMaterial, registrarHistorial } from '../services/historial'

const mxn = (n: number) => `$${(n ?? 0).toFixed(2)}`
const usdFmt = (n: number) => `US$${(n ?? 0).toFixed(2)}`

// Genera la siguiente clave para una categoría (ej. EL0001, EL0002...).
// Toma el número más alto existente para ese prefijo y le suma 1.
const generarClave = async (categoriaId: string) => {
    const categoria = getCategoria(categoriaId)
    if (!categoria) {
        throw new Error('Categoría no válida')
    }
    const prefijo = categoria.prefijo

    const existentes = await Material.find({ clave: new RegExp(`^${prefijo}\\d+$`) }).select('clave')
    let maximo = 0
    for (const m of existentes) {
        const num = parseInt(m.clave.slice(prefijo.length), 10)
        if (!isNaN(num) && num > maximo) {
            maximo = num
        }
    }
    const siguiente = (maximo + 1).toString().padStart(4, '0')
    return `${prefijo}${siguiente}`
}

export class MaterialController {
    // Catálogo de categorías (para llenar selects en el front)
    static obtenerCategorias = async (req: Request, res: Response) => {
        res.json(CATEGORIAS)
    }

    // Listar materiales (con nombre/código de proveedores)
    static obtenerMateriales = async (req: Request, res: Response) => {
        try {
            const materiales = await Material.find()
                .populate('proveedorPrincipal', 'codigo razonSocial')
                .populate('proveedoresAsociados', 'codigo razonSocial')
                .sort({ clave: 1 })
            res.json(materiales)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener materiales' })
        }
    }

    // Detalle de un material
    static obtenerMaterialPorId = async (req: Request, res: Response) => {
        try {
            const material = await Material.findById(req.params.id)
                .populate('proveedorPrincipal', 'codigo razonSocial')
                .populate('proveedoresAsociados', 'codigo razonSocial')
            if (!material) {
                return res.status(404).json({ error: 'Material no encontrado' })
            }
            res.json(material)
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener el material' })
        }
    }

    // Crear material (clave autogenerada)
    static crearMaterial = async (req: Request, res: Response) => {
        try {
            const { categoriaPrincipal } = req.body

            const material = new Material(req.body)
            material.clave = await generarClave(categoriaPrincipal)
            // Importe unitario = costo (cantidad implícita 1)
            material.importeMXN = material.costoUnitario
            material.importeUSD = material.costoUSD

            await material.save()
            res.status(201).json({ mensaje: 'Material creado correctamente', clave: material.clave, id: material.id })
        } catch (error) {
            if (error instanceof Error && error.message === 'Categoría no válida') {
                return res.status(400).json({ error: error.message })
            }
            res.status(500).json({ error: 'Error al crear el material' })
        }
    }

    // Actualizar material.
    // La clave NO cambia con la edición para no romper el histórico,
    // aunque se cambie de categoría principal.
    static actualizarMaterial = async (req: Request, res: Response) => {
        try {
            const material = await Material.findById(req.params.id)
            if (!material) {
                return res.status(404).json({ error: 'Material no encontrado' })
            }
            // Snapshot ANTERIOR para el historial
            const antes = {
                concepto: material.concepto,
                categoria: material.categoriaPrincipal,
                costoMXN: material.costoUnitario,
                costoUSD: material.costoUSD,
            }

            // Proteger la clave contra sobreescritura
            delete req.body.clave
            Object.assign(material, req.body)
            // Importe unitario = costo
            material.importeMXN = material.costoUnitario
            material.importeUSD = material.costoUSD
            await material.save()

            // Sincroniza el costo a TODOS los componentes que usan este material
            await sincComponentesDesdeMaterial(material.id, material.costoUnitario, material.costoUSD)

            // Historial: cambios hechos desde el CATÁLOGO maestro
            const cambios: string[] = []
            let sensible = false
            if (antes.concepto !== material.concepto) {
                cambios.push(`Concepto: ${antes.concepto} → ${material.concepto}`)
            }
            if (antes.categoria !== material.categoriaPrincipal) {
                cambios.push(`Categoría principal: ${antes.categoria} → ${material.categoriaPrincipal}`)
                sensible = true
            }
            if (antes.costoMXN !== material.costoUnitario) {
                cambios.push(`Costo MXN: ${mxn(antes.costoMXN)} → ${mxn(material.costoUnitario)}`)
            }
            if (antes.costoUSD !== material.costoUSD) {
                cambios.push(`Costo USD: ${usdFmt(antes.costoUSD)} → ${usdFmt(material.costoUSD)}`)
            }
            if (cambios.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'material',
                    material: material._id as never,
                    materialClave: material.clave,
                    materialConcepto: material.concepto,
                    equiposAfectados: await equiposAfectadosPorMaterial(material.id),
                    cambios,
                    sensible,
                })
            }

            res.json({ mensaje: 'Material actualizado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el material' })
        }
    }

    // Eliminar material
    static eliminarMaterial = async (req: Request, res: Response) => {
        try {
            const material = await Material.findById(req.params.id)
            if (!material) {
                return res.status(404).json({ error: 'Material no encontrado' })
            }
            await material.deleteOne()
            res.json({ mensaje: 'Material eliminado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el material' })
        }
    }
}

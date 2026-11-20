import type { Request, Response } from 'express'
import Material from '../models/Material'
import Componente from '../models/Componente'
import Inventario from '../models/Inventario'
import OrdenCompra from '../models/OrdenCompra'
import { getCategoriasConfig, getPrefijoCategoria } from '../models/Configuracion'
import { diffPersonalizados, limpiarPersonalizados } from '../services/camposPersonalizados'
import { sincComponentesDesdeMaterial } from '../services/sincronizarCostos'
import { equiposAfectadosPorMaterial, registrarHistorial } from '../services/historial'

const mxn = (n: number) => `$${(n ?? 0).toFixed(2)}`
const usdFmt = (n: number) => `US$${(n ?? 0).toFixed(2)}`

// Ajusta los costos según la moneda declarada: la moneda que NO se compra queda en 0
// (vacía). Así "solo pesos", "solo dólares" o "ambos" quedan coherentes en el catálogo.
const aplicarMoneda = (m: { moneda?: string; monedaPrincipal?: string; costoUnitario?: number; costoUSD?: number }) => {
    const moneda = m.moneda === 'usd' || m.moneda === 'ambos' ? m.moneda : 'mxn'
    m.moneda = moneda
    m.costoUnitario = Number(m.costoUnitario) || 0
    m.costoUSD = Number(m.costoUSD) || 0
    if (moneda === 'usd') {
        m.costoUnitario = 0
        m.monedaPrincipal = 'usd'
    } else if (moneda === 'mxn') {
        m.costoUSD = 0
        m.monedaPrincipal = 'mxn'
    } else {
        // 'ambos': se conservan los dos costos; la principal la elige el usuario
        m.monedaPrincipal = m.monedaPrincipal === 'usd' ? 'usd' : 'mxn'
    }
}

// Campos que el formulario puede escribir (lista blanca: evita asignación masiva de
// clave, _id, importes, activo, fechas…). `personalizados` se trata aparte.
const CAMPOS_EDITABLES = [
    'concepto', 'categoriaPrincipal', 'proveedorPrincipal', 'proveedoresAsociados',
    'moneda', 'monedaPrincipal', 'costoUnitario', 'costoUSD',
] as const
const datosPermitidos = (body: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    for (const c of CAMPOS_EDITABLES) if (body[c] !== undefined) out[c] = body[c]
    return out
}

// Genera la siguiente clave para una categoría (ej. EL0001, EL0002...).
// Toma el número más alto existente para ese prefijo y le suma 1.
const generarClave = async (categoriaId: string) => {
    // El prefijo lo define la empresa en Configuración (editable). El id (A-E) es fijo.
    const prefijo = await getPrefijoCategoria(categoriaId)
    if (!prefijo) {
        throw new Error('Categoría no válida')
    }

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
    // Catálogo de categorías configuradas (nombre + prefijo). Para selects del front.
    static obtenerCategorias = async (req: Request, res: Response) => {
        res.json(await getCategoriasConfig())
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

            aplicarMoneda(req.body)
            const material = new Material(datosPermitidos(req.body))
            material.clave = await generarClave(categoriaPrincipal)
            // Importe unitario = costo (cantidad implícita 1)
            material.importeMXN = material.costoUnitario
            material.importeUSD = material.costoUSD
            material.personalizados = await limpiarPersonalizados('materiales', req.body.personalizados)

            await material.save()
            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'material',
                sector: 'catalogos',
                accion: 'creo',
                entidad: `${material.clave} · ${material.concepto}`,
                material: material._id as never,
                materialClave: material.clave,
                materialConcepto: material.concepto,
                cambios: ['Alta de material en el catálogo'],
            })
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

            // Si viene la moneda (edición desde el catálogo), reajusta los costos a esa moneda
            if (req.body.moneda !== undefined) aplicarMoneda(req.body)
            // Los datos adicionales se tratan aparte (limpios y conservando los de campos ocultos)
            const persAntes = material.personalizados ?? {}
            const persEntrada = req.body.personalizados
            // Solo campos permitidos: la clave, los importes y demás internos no se pueden sobrescribir
            Object.assign(material, datosPermitidos(req.body))
            // Importe unitario = costo
            material.importeMXN = material.costoUnitario
            material.importeUSD = material.costoUSD
            let cambiosPers: string[] = []
            if (persEntrada !== undefined) {
                material.personalizados = await limpiarPersonalizados('materiales', persEntrada, persAntes)
                material.markModified('personalizados')
                cambiosPers = await diffPersonalizados('materiales', persAntes, material.personalizados)
            }
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
            cambios.push(...cambiosPers)
            if (cambios.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'material',
                    sector: 'catalogos',
                    accion: 'edito',
                    entidad: `${material.clave} · ${material.concepto}`,
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

    // Eliminar material — solo si NO está en uso en ninguna parte viva del sistema.
    // (Las cotizaciones no bloquean: guardan snapshot propio y siguen mostrando bien
    //  sus costos aunque el material desaparezca del catálogo.)
    static eliminarMaterial = async (req: Request, res: Response) => {
        try {
            const material = await Material.findById(req.params.id)
            if (!material) {
                return res.status(404).json({ error: 'Material no encontrado' })
            }

            const [enComponentes, enInventario, enOrdenes] = await Promise.all([
                Componente.countDocuments({ 'variaciones.materiales.material': material.id }),
                Inventario.countDocuments({ material: material.id }),
                OrdenCompra.countDocuments({ 'items.material': material.id }),
            ])

            const usos: string[] = []
            if (enComponentes > 0) usos.push(`${enComponentes} componente(s) del BOM`)
            if (enInventario > 0) usos.push('el inventario')
            if (enOrdenes > 0) usos.push(`${enOrdenes} orden(es) de compra`)

            if (usos.length > 0) {
                return res.status(409).json({
                    error: `No se puede eliminar "${material.clave} ${material.concepto}": está en uso en ${usos.join(', ')}.`,
                })
            }

            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'material',
                sector: 'catalogos',
                accion: 'elimino',
                entidad: `${material.clave} · ${material.concepto}`,
                materialClave: material.clave,
                materialConcepto: material.concepto,
                cambios: ['Material eliminado del catálogo'],
                sensible: true,
            })
            await material.deleteOne()
            res.json({ mensaje: 'Material eliminado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el material' })
        }
    }
}

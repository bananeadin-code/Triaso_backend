import type { Request, Response } from 'express'
import Proveedor from '../models/Proveedor'
import Material from '../models/Material'
import OrdenCompra from '../models/OrdenCompra'
import { registrarHistorial } from '../services/historial'
import { diffPersonalizados, limpiarPersonalizados } from '../services/camposPersonalizados'

// Campos editables del proveedor (lista blanca: evita asignación masiva de _id, activo, fechas…)
const CAMPOS: Record<string, string> = {
    codigo: 'Código', razonSocial: 'Razón social', rfc: 'RFC', direccion: 'Dirección',
    contacto: 'Contacto', telefono: 'Teléfono', email: 'Correo', cuenta: 'Cuenta',
    clabe: 'CLABE', banco: 'Banco', referencia: 'Referencia',
}
const datosPermitidos = (body: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    for (const c of Object.keys(CAMPOS)) if (body[c] !== undefined) out[c] = body[c]
    return out
}

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
            }).select('clave concepto costoUnitario costoUSD moneda monedaPrincipal categoriaPrincipal')

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
            const proveedor = new Proveedor(datosPermitidos(req.body))
            proveedor.personalizados = await limpiarPersonalizados('proveedores', req.body.personalizados)
            await proveedor.save()
            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'proveedor',
                sector: 'catalogos',
                accion: 'creo',
                entidad: `${proveedor.codigo} · ${proveedor.razonSocial}`,
                cambios: ['Alta de proveedor'],
            })
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

            // Snapshot para el historial
            const antes: Record<string, string> = {}
            for (const c of Object.keys(CAMPOS)) antes[c] = String((proveedor as unknown as Record<string, unknown>)[c] ?? '')
            const persAntes = proveedor.personalizados ?? {}

            Object.assign(proveedor, datosPermitidos(req.body))
            let cambiosPers: string[] = []
            if (req.body.personalizados !== undefined) {
                proveedor.personalizados = await limpiarPersonalizados('proveedores', req.body.personalizados, persAntes)
                proveedor.markModified('personalizados')
                cambiosPers = await diffPersonalizados('proveedores', persAntes, proveedor.personalizados)
            }
            await proveedor.save()

            const cambios: string[] = []
            for (const [c, etiqueta] of Object.entries(CAMPOS)) {
                const ahora = String((proveedor as unknown as Record<string, unknown>)[c] ?? '')
                if (antes[c] !== ahora) cambios.push(`${etiqueta}: ${antes[c] || '—'} → ${ahora || '—'}`)
            }
            cambios.push(...cambiosPers)
            if (cambios.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'proveedor',
                    sector: 'catalogos',
                    accion: 'edito',
                    entidad: `${proveedor.codigo} · ${proveedor.razonSocial}`,
                    cambios,
                })
            }
            res.json({ mensaje: 'Proveedor actualizado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el proveedor' })
        }
    }

    // Importación en lote desde Excel. Upsert por CÓDIGO: crea los nuevos y actualiza
    // los existentes (solo con los campos que vengan). Tolerante: no falla toda la carga
    // por una fila mala; devuelve el resumen y las filas omitidas con su motivo.
    static importarProveedores = async (req: Request, res: Response) => {
        try {
            const entrada = Array.isArray(req.body?.proveedores) ? req.body.proveedores : []
            if (entrada.length === 0) {
                return res.status(400).json({ error: 'No se recibieron proveedores para importar' })
            }

            const CAMPOS = ['razonSocial', 'rfc', 'direccion', 'contacto', 'telefono', 'email', 'cuenta', 'clabe', 'banco', 'referencia'] as const
            let creados = 0
            let actualizados = 0
            const omitidos: { fila: number; codigo: string; motivo: string }[] = []

            for (let i = 0; i < entrada.length; i++) {
                const row = entrada[i] ?? {}
                const codigo = String(row.codigo ?? '').toUpperCase().trim()
                const razonSocial = String(row.razonSocial ?? '').trim()
                if (!codigo) {
                    omitidos.push({ fila: i + 1, codigo: '', motivo: 'Sin código' })
                    continue
                }
                if (!razonSocial) {
                    omitidos.push({ fila: i + 1, codigo, motivo: 'Sin razón social / beneficiario' })
                    continue
                }

                const existente = await Proveedor.findOne({ codigo })
                if (existente) {
                    for (const c of CAMPOS) {
                        if (row[c] !== undefined && row[c] !== null && String(row[c]).trim() !== '') {
                            ;(existente as unknown as Record<string, unknown>)[c] = String(row[c]).trim()
                        }
                    }
                    await existente.save()
                    actualizados++
                } else {
                    const datos: Record<string, unknown> = { codigo, razonSocial }
                    for (const c of CAMPOS) {
                        if (c !== 'razonSocial' && row[c] !== undefined && row[c] !== null) {
                            datos[c] = String(row[c]).trim()
                        }
                    }
                    await Proveedor.create(datos)
                    creados++
                }
            }

            if (creados > 0 || actualizados > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'importacion',
                    sector: 'catalogos',
                    accion: 'importo',
                    entidad: 'Proveedores (Excel)',
                    cambios: [
                        `${creados} proveedor(es) nuevo(s), ${actualizados} actualizado(s)` +
                            (omitidos.length ? `, ${omitidos.length} omitido(s)` : ''),
                    ],
                    sensible: true,
                })
            }

            res.json({
                mensaje: `Importación terminada: ${creados} creado(s), ${actualizados} actualizado(s), ${omitidos.length} omitido(s)`,
                creados,
                actualizados,
                omitidos,
            })
        } catch (error) {
            res.status(500).json({ error: 'Error al importar proveedores' })
        }
    }

    // Eliminar proveedor (bloquea si tiene materiales asociados)
    static eliminarProveedor = async (req: Request, res: Response) => {
        try {
            const proveedor = await Proveedor.findById(req.params.id)
            if (!proveedor) {
                return res.status(404).json({ error: 'Proveedor no encontrado' })
            }

            const [enMateriales, enOrdenes] = await Promise.all([
                Material.countDocuments({
                    $or: [{ proveedorPrincipal: proveedor.id }, { proveedoresAsociados: proveedor.id }],
                }),
                OrdenCompra.countDocuments({ proveedor: proveedor.id }),
            ])

            const usos: string[] = []
            if (enMateriales > 0) usos.push(`${enMateriales} material(es)`)
            if (enOrdenes > 0) usos.push(`${enOrdenes} orden(es) de compra`)

            if (usos.length > 0) {
                return res.status(409).json({
                    error: `No se puede eliminar "${proveedor.codigo}": está asociado a ${usos.join(' y ')}.`,
                })
            }

            await registrarHistorial({
                usuario: req.usuario?.nombre ?? 'Sistema',
                tipo: 'proveedor',
                sector: 'catalogos',
                accion: 'elimino',
                entidad: `${proveedor.codigo} · ${proveedor.razonSocial}`,
                cambios: ['Proveedor eliminado del directorio'],
                sensible: true,
            })
            await proveedor.deleteOne()
            res.json({ mensaje: 'Proveedor eliminado correctamente' })
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el proveedor' })
        }
    }
}

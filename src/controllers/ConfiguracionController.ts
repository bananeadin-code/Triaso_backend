import type { Request, Response } from 'express'
import { getConfiguracion, getCategoriasConfig, getEmpresa, getCamposModulo, getUnidades, getFolios, getTipoCambio, siguienteIdCategoria, siguienteIdCampo } from '../models/Configuracion'
import { upsertParidadHoy } from '../models/Paridad'
import Material from '../models/Material'
import Componente from '../models/Componente'
import { registrarHistorial } from '../services/historial'
import { MODULOS_CAMPOS, esModuloCampos } from '../services/camposPersonalizados'

// Definiciones de campos personalizados de TODOS los módulos ({ materiales: [...], proveedores: [...] })
async function camposTodos() {
    const out: Record<string, Awaited<ReturnType<typeof getCamposModulo>>> = {}
    for (const m of MODULOS_CAMPOS) out[m] = await getCamposModulo(m)
    return out
}

export class ConfiguracionController {
    // Campos ACTIVOS de un módulo (el módulo ya viene validado por la ruta)
    static obtenerCamposModulo = async (req: Request, res: Response) => {
        try {
            res.json((await getCamposModulo(String(req.params.modulo))).filter((c) => c.activo))
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener los campos' })
        }
    }

    // Lee los parámetros de la empresa (cualquier usuario autenticado los necesita
    // para mostrar totales consolidados y las categorías).
    static obtener = async (req: Request, res: Response) => {
        try {
            const cfg = await getConfiguracion()
            res.json({
                tipoCambio: await getTipoCambio(),
                categorias: await getCategoriasConfig(),
                empresa: await getEmpresa(),
                campos: await camposTodos(),
                unidades: await getUnidades(),
                folios: await getFolios(),
                banxicoConfigurado: !!cfg.banxicoToken,
            })
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener la configuración' })
        }
    }

    // Actualiza los parámetros (solo administración: admin/operador).
    static actualizar = async (req: Request, res: Response) => {
        try {
            const cfg = await getConfiguracion()
            const tcAntes = await getTipoCambio()
            const cambiosCategorias: string[] = []
            const cambiosEmpresa: string[] = []
            const cambiosCampos: string[] = []
            let moduloCampos = ''
            const cambiosOtros: string[] = []
            let tcNuevo: number | null = null

            // --- Tipo de cambio ---
            if (req.body.tipoCambio !== undefined) {
                const tc = Number(req.body.tipoCambio)
                if (isNaN(tc) || tc < 0) {
                    return res.status(400).json({ error: 'Tipo de cambio no válido' })
                }
                cfg.tipoCambio = tc
                if (tc !== tcAntes) tcNuevo = tc
            }

            // --- Categorías (lista dinámica: editar, agregar o quitar) ---
            if (Array.isArray(req.body.categorias)) {
                const antes = await getCategoriasConfig()
                const entrada = req.body.categorias as { id?: string; nombre: string; prefijo: string }[]
                if (entrada.length === 0) {
                    return res.status(400).json({ error: 'Debe haber al menos una categoría' })
                }

                const prefijos = new Set<string>()
                const idsUsados = new Set(antes.map((c) => c.id))
                const idsFinales = new Set<string>()
                const nuevas: { id: string; nombre: string; prefijo: string }[] = []

                for (const e of entrada) {
                    const nombre = String(e.nombre ?? '').trim()
                    const prefijo = String(e.prefijo ?? '').trim().toUpperCase()
                    if (!nombre) return res.status(400).json({ error: 'Cada categoría necesita un nombre' })
                    if (!prefijo) return res.status(400).json({ error: `La categoría "${nombre}" necesita un prefijo de clave` })
                    if (!/^[A-Z]{1,4}$/.test(prefijo)) {
                        return res.status(400).json({ error: `El prefijo "${prefijo}" debe ser de 1 a 4 letras` })
                    }
                    if (prefijos.has(prefijo)) {
                        return res.status(400).json({ error: `El prefijo "${prefijo}" está repetido; cada categoría necesita uno distinto` })
                    }
                    prefijos.add(prefijo)

                    // id: si viene con un id existente se conserva (edición); si no, es NUEVA
                    let id = String(e.id ?? '').trim().toUpperCase()
                    if (!id || !antes.some((c) => c.id === id)) {
                        id = siguienteIdCategoria([...idsUsados])
                        idsUsados.add(id)
                    }
                    if (idsFinales.has(id)) {
                        return res.status(400).json({ error: 'Hay categorías con el mismo id' })
                    }
                    idsFinales.add(id)
                    nuevas.push({ id, nombre, prefijo })
                }

                // Eliminadas = ids previos que ya no están → GUARDA: no borrar si está en uso
                const eliminadas = antes.filter((c) => !idsFinales.has(c.id))
                for (const del of eliminadas) {
                    const [enMat, enComp] = await Promise.all([
                        Material.countDocuments({ categoriaPrincipal: del.id }),
                        Componente.countDocuments({ 'variaciones.materiales.tipo': del.id }),
                    ])
                    const usos: string[] = []
                    if (enMat > 0) usos.push(`${enMat} material(es)`)
                    if (enComp > 0) usos.push(`${enComp} componente(s)`)
                    if (usos.length > 0) {
                        return res.status(400).json({
                            error: `No se puede eliminar la categoría "${del.nombre}": está en uso en ${usos.join(' y ')}. Reasigna esos registros a otra categoría primero.`,
                        })
                    }
                }

                // Cambios para el historial
                for (const n of nuevas) {
                    const a = antes.find((c) => c.id === n.id)
                    if (!a) cambiosCategorias.push(`Categoría agregada: ${n.nombre} (prefijo ${n.prefijo})`)
                    else if (a.nombre !== n.nombre || a.prefijo !== n.prefijo) {
                        cambiosCategorias.push(`Categoría ${n.id}: ${a.nombre} (${a.prefijo}) → ${n.nombre} (${n.prefijo})`)
                    }
                }
                for (const del of eliminadas) cambiosCategorias.push(`Categoría eliminada: ${del.nombre} (${del.id})`)

                cfg.categorias = nuevas as never
            }

            // --- Datos de la empresa (para los PDF) ---
            if (req.body.empresa && typeof req.body.empresa === 'object') {
                const antes = await getEmpresa()
                const CAMPOS: Record<string, string> = { razonSocial: 'Razón social', rfc: 'RFC', direccion: 'Dirección', telefono: 'Teléfono' }
                const e = req.body.empresa as Record<string, unknown>
                const emp = {
                    razonSocial: String(e.razonSocial ?? antes.razonSocial ?? '').trim(),
                    rfc: String(e.rfc ?? antes.rfc ?? '').trim().toUpperCase(),
                    direccion: String(e.direccion ?? antes.direccion ?? '').trim(),
                    telefono: String(e.telefono ?? antes.telefono ?? '').trim(),
                }
                cfg.empresa = emp as never
                const antesR = antes as unknown as Record<string, string>
                const empR = emp as unknown as Record<string, string>
                for (const [k, etiqueta] of Object.entries(CAMPOS)) {
                    if (antesR[k] !== empR[k]) {
                        cambiosEmpresa.push(`${etiqueta}: ${antesR[k] || '—'} → ${empR[k] || '—'}`)
                    }
                }
            }

            // --- Campos personalizados de un módulo (informativos) ---
            if (req.body.campos && typeof req.body.campos === 'object' && Array.isArray(req.body.campos.lista)) {
                const modulo = String(req.body.campos.modulo ?? 'materiales')
                if (!esModuloCampos(modulo)) return res.status(400).json({ error: 'Módulo no válido para campos personalizados' })
                moduloCampos = modulo
                const antes = await getCamposModulo(modulo)
                const TIPOS = ['texto', 'numero', 'lista', 'siNo', 'fecha']
                const entrada = req.body.campos.lista as { id?: string; nombre: string; tipo: string; opciones?: string[]; activo?: boolean }[]

                const idsUsados = new Set(antes.map((c) => c.id))
                const idsFinales = new Set<string>()
                const lista: { id: string; nombre: string; tipo: string; opciones: string[]; activo: boolean }[] = []

                for (const e of entrada) {
                    const nombre = String(e.nombre ?? '').trim()
                    if (!nombre) return res.status(400).json({ error: 'Cada campo personalizado necesita un nombre' })
                    const tipo = TIPOS.includes(e.tipo) ? e.tipo : 'texto'
                    const opciones =
                        tipo === 'lista' && Array.isArray(e.opciones)
                            ? e.opciones.map((o) => String(o).trim()).filter(Boolean)
                            : []
                    if (tipo === 'lista' && opciones.length === 0) {
                        return res.status(400).json({ error: `El campo "${nombre}" es de tipo lista y necesita al menos una opción` })
                    }
                    let id = String(e.id ?? '').trim()
                    if (!id || !antes.some((c) => c.id === id)) {
                        id = siguienteIdCampo([...idsUsados])
                        idsUsados.add(id)
                    }
                    if (idsFinales.has(id)) return res.status(400).json({ error: 'Hay campos con el mismo id' })
                    idsFinales.add(id)
                    lista.push({ id, nombre, tipo, opciones, activo: e.activo !== false })
                }

                // Cambios para el historial
                for (const n of lista) {
                    const a = antes.find((c) => c.id === n.id)
                    if (!a) cambiosCampos.push(`Campo agregado: ${n.nombre} (${n.tipo})`)
                    else if (a.nombre !== n.nombre || a.tipo !== n.tipo || a.activo !== n.activo) {
                        cambiosCampos.push(`Campo ${n.nombre}: ${a.activo !== n.activo ? (n.activo ? 'activado' : 'ocultado') : 'editado'}`)
                    }
                }
                for (const a of antes) if (!idsFinales.has(a.id)) cambiosCampos.push(`Campo eliminado: ${a.nombre}`)

                // Upsert del módulo en cfg.campos
                const camposCfg = (cfg.campos ?? []) as unknown as { modulo: string; lista: unknown[] }[]
                const idx = camposCfg.findIndex((c) => c.modulo === modulo)
                if (idx >= 0) camposCfg[idx].lista = lista
                else camposCfg.push({ modulo, lista })
                cfg.campos = camposCfg as never
                cfg.markModified('campos')
            }

            // --- Unidades de medida ---
            if (Array.isArray(req.body.unidades)) {
                const antes = (await getUnidades()).join(', ')
                const limpias = [
                    ...new Set(
                        (req.body.unidades as unknown[]).map((u) => String(u).trim()).filter(Boolean)
                    ),
                ]
                if (limpias.length === 0) return res.status(400).json({ error: 'Debe quedar al menos una unidad' })
                cfg.unidades = limpias as never
                if (antes !== limpias.join(', ')) cambiosOtros.push(`Unidades: ${antes} → ${limpias.join(', ')}`)
            }

            // --- Folios (prefijos) ---
            if (req.body.folios && typeof req.body.folios === 'object') {
                const antes = await getFolios()
                const f = req.body.folios as { orden?: string; cotizacion?: string }
                const orden = String(f.orden ?? antes.orden).trim().toUpperCase()
                const cotizacion = String(f.cotizacion ?? antes.cotizacion).trim().toUpperCase()
                for (const [p, etq] of [[orden, 'órdenes'], [cotizacion, 'cotizaciones']] as const) {
                    if (!/^[A-Z]{1,6}$/.test(p)) {
                        return res.status(400).json({ error: `El prefijo de folio de ${etq} debe ser de 1 a 6 letras` })
                    }
                }
                cfg.folios = { orden, cotizacion } as never
                if (antes.orden !== orden) cambiosOtros.push(`Folio de órdenes: ${antes.orden} → ${orden}`)
                if (antes.cotizacion !== cotizacion) cambiosOtros.push(`Folio de cotizaciones: ${antes.cotizacion} → ${cotizacion}`)
            }

            // --- Token de Banxico (para el tipo de cambio automático) ---
            if (req.body.banxicoToken !== undefined) {
                const nuevo = String(req.body.banxicoToken).trim()
                if (nuevo !== (cfg.banxicoToken || '')) {
                    cfg.banxicoToken = nuevo
                    cambiosOtros.push(nuevo ? 'Token de Banxico configurado' : 'Token de Banxico eliminado')
                }
            }

            await cfg.save()

            // Historial (sector Sistema)
            if (tcNuevo !== null) {
                // Registra el cambio en la bitácora de PARIDAD (el valor de hoy)
                await upsertParidadHoy(tcNuevo, 'config', req.usuario?.nombre ?? 'Sistema')
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'sistema',
                    sector: 'sistema',
                    accion: 'edito',
                    entidad: 'Tipo de cambio',
                    cambios: [`Tipo de cambio: $${tcAntes.toFixed(2)} → $${tcNuevo.toFixed(2)} por USD`],
                })
            }
            if (cambiosCategorias.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'sistema',
                    sector: 'sistema',
                    accion: 'edito',
                    entidad: 'Categorías',
                    cambios: cambiosCategorias,
                    sensible: true,
                })
            }
            if (cambiosEmpresa.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'sistema',
                    sector: 'sistema',
                    accion: 'edito',
                    entidad: 'Datos de la empresa',
                    cambios: cambiosEmpresa,
                })
            }
            if (cambiosCampos.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'sistema',
                    sector: 'sistema',
                    accion: 'edito',
                    entidad: `Campos personalizados (${moduloCampos})`,
                    cambios: cambiosCampos,
                })
            }
            if (cambiosOtros.length > 0) {
                await registrarHistorial({
                    usuario: req.usuario?.nombre ?? 'Sistema',
                    tipo: 'sistema',
                    sector: 'sistema',
                    accion: 'edito',
                    entidad: 'Parámetros (unidades / folios)',
                    cambios: cambiosOtros,
                })
            }

            res.json({
                mensaje: 'Configuración actualizada',
                tipoCambio: await getTipoCambio(),
                categorias: await getCategoriasConfig(),
                empresa: await getEmpresa(),
                campos: await camposTodos(),
                unidades: await getUnidades(),
                folios: await getFolios(),
                banxicoConfigurado: !!cfg.banxicoToken,
            })
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar la configuración' })
        }
    }
}

import mongoose, { Document, Schema } from 'mongoose'
import { CATEGORIAS } from '../config/categorias'

// Categoría configurable: el id (A-E) es fijo; el nombre y el prefijo de clave los edita
// la empresa para alinear el sistema a su propia nomenclatura.
export interface ICategoriaConfig {
    id: string
    nombre: string
    prefijo: string
}

// Datos fiscales/de contacto de la empresa (salen en los PDF que genera el sistema)
export interface IEmpresa {
    razonSocial: string
    rfc: string
    direccion: string
    telefono: string
}

// Campo personalizado (INFORMATIVO): dato extra que la empresa agrega a un catálogo.
// NUNCA participa en el motor (costeo, BOM, moneda, inventario, claves); solo se muestra.
export type TipoCampo = 'texto' | 'numero' | 'lista' | 'siNo' | 'fecha'
export interface ICampoDef {
    id: string // clave estable con la que se guarda el valor en el registro
    nombre: string // etiqueta visible
    tipo: TipoCampo
    opciones: string[] // solo para tipo 'lista'
    activo: boolean // inactivo = se oculta sin borrar los valores ya capturados
}
export interface ICamposModulo {
    modulo: string // 'materiales' | 'proveedores' | ... (por ahora 'materiales')
    lista: ICampoDef[]
}

// Prefijos de folio configurables (órdenes y cotizaciones)
export interface IFolios {
    orden: string // ej. 'OC'
    cotizacion: string // ej. 'COT'
}

// Parámetros globales de la empresa (documento único / singleton).
export interface IConfiguracion extends Document {
    tipoCambio: number // MXN por 1 USD (referencial, lo fija la empresa a mano)
    categorias: ICategoriaConfig[] // nombre + prefijo de clave por categoría (id dinámico)
    empresa: IEmpresa // datos para los reportes/tickets
    campos: ICamposModulo[] // campos personalizados por módulo
    unidades: string[] // catálogo de unidades de medida (Pieza, Metro, Kg…)
    folios: IFolios // prefijos de folio de órdenes y cotizaciones
    banxicoToken: string // token para traer el tipo de cambio de Banxico (no se expone al front)
}

const UNIDADES_DEFAULT = ['Pieza', 'Metro', 'Kilogramo', 'Litro', 'Juego', 'Rollo', 'Caja', 'Par']

const CategoriaConfigSchema = new Schema<ICategoriaConfig>(
    {
        id: { type: String, required: true },
        nombre: { type: String, default: '' },
        prefijo: { type: String, default: '', uppercase: true, trim: true },
    },
    { _id: false }
)

// Valores por defecto de categorías (los 5 originales)
const categoriasDefault = (): ICategoriaConfig[] => CATEGORIAS.map((c) => ({ id: c.id, nombre: c.nombre, prefijo: c.prefijo }))

const EmpresaSchema = new Schema<IEmpresa>(
    {
        razonSocial: { type: String, default: '', trim: true },
        rfc: { type: String, default: '', trim: true, uppercase: true },
        direccion: { type: String, default: '', trim: true },
        telefono: { type: String, default: '', trim: true },
    },
    { _id: false }
)

const CampoDefSchema = new Schema<ICampoDef>(
    {
        id: { type: String, required: true },
        nombre: { type: String, default: '' },
        tipo: { type: String, enum: ['texto', 'numero', 'lista', 'siNo', 'fecha'], default: 'texto' },
        opciones: { type: [String], default: [] },
        activo: { type: Boolean, default: true },
    },
    { _id: false }
)
const CamposModuloSchema = new Schema<ICamposModulo>(
    {
        modulo: { type: String, required: true },
        lista: { type: [CampoDefSchema], default: [] },
    },
    { _id: false }
)

const ConfiguracionSchema: Schema = new Schema(
    {
        tipoCambio: { type: Number, default: 20, min: 0 },
        categorias: { type: [CategoriaConfigSchema], default: categoriasDefault },
        empresa: { type: EmpresaSchema, default: () => ({}) },
        campos: { type: [CamposModuloSchema], default: [] },
        unidades: { type: [String], default: () => [...UNIDADES_DEFAULT] },
        banxicoToken: { type: String, default: '' },
        folios: {
            type: new Schema<IFolios>(
                {
                    orden: { type: String, default: 'OC', uppercase: true, trim: true },
                    cotizacion: { type: String, default: 'COT', uppercase: true, trim: true },
                },
                { _id: false }
            ),
            default: () => ({ orden: 'OC', cotizacion: 'COT' }),
        },
    },
    { timestamps: true }
)

const Configuracion = mongoose.model<IConfiguracion>('Configuracion', ConfiguracionSchema)
export default Configuracion

// Devuelve (o crea) el documento único de configuración.
export async function getConfiguracion() {
    let cfg = await Configuracion.findOne()
    if (!cfg) cfg = await Configuracion.create({})
    // Auto-relleno para documentos viejos que aún no tenían categorías
    if (!cfg.categorias || cfg.categorias.length === 0) {
        cfg.categorias = categoriasDefault() as never
        await cfg.save()
    }
    return cfg
}

// Tipo de cambio vigente = el valor del registro de PARIDAD más reciente.
// (import dinámico para evitar el ciclo: Paridad importa getConfiguracion de aquí.)
export async function getTipoCambio() {
    const { getParidadVigente } = await import('./Paridad')
    const p = await getParidadVigente()
    return p.valor || 0
}

// Datos de la empresa (para los PDF). Objeto plano, con respaldo a strings vacíos.
export async function getEmpresa(): Promise<IEmpresa> {
    const cfg = await getConfiguracion()
    const e = cfg.empresa ?? ({} as IEmpresa)
    return {
        razonSocial: e.razonSocial ?? '',
        rfc: e.rfc ?? '',
        direccion: e.direccion ?? '',
        telefono: e.telefono ?? '',
    }
}

// Categorías configuradas (lista DINÁMICA: la empresa puede editar, agregar o quitar).
// Respaldo a los defaults solo si el documento aún no tiene ninguna.
export async function getCategoriasConfig(): Promise<ICategoriaConfig[]> {
    const cfg = await getConfiguracion()
    const guardadas = cfg.categorias ?? []
    if (guardadas.length === 0) return categoriasDefault()
    return guardadas.map((g) => ({ id: g.id, nombre: g.nombre, prefijo: (g.prefijo || '').toUpperCase() }))
}

// Siguiente id disponible (letra A-Z que no esté en uso) para una categoría nueva.
export function siguienteIdCategoria(usados: string[]): string {
    const set = new Set(usados.map((x) => x.toUpperCase()))
    for (let i = 65; i <= 90; i++) {
        const letra = String.fromCharCode(i)
        if (!set.has(letra)) return letra
    }
    // Si se agotaron A-Z, usa C + número
    let n = 1
    while (set.has(`C${n}`)) n++
    return `C${n}`
}

// Prefijo de clave vigente para una categoría (para generar claves de material).
export async function getPrefijoCategoria(id: string): Promise<string | undefined> {
    const cats = await getCategoriasConfig()
    return cats.find((c) => c.id === id)?.prefijo
}

// Campos personalizados definidos para un módulo (lista completa, activos e inactivos).
export async function getCamposModulo(modulo: string): Promise<ICampoDef[]> {
    const cfg = await getConfiguracion()
    const entry = (cfg.campos ?? []).find((c) => c.modulo === modulo)
    return (entry?.lista ?? []).map((c) => ({
        id: c.id,
        nombre: c.nombre,
        tipo: c.tipo,
        opciones: c.opciones ?? [],
        activo: c.activo !== false,
    }))
}

// Siguiente id de campo (campoN) que no choque con los usados.
export function siguienteIdCampo(usados: string[]): string {
    const set = new Set(usados)
    let n = 1
    while (set.has(`campo${n}`)) n++
    return `campo${n}`
}

// Catálogo de unidades de medida configurado (con respaldo a los defaults).
export async function getUnidades(): Promise<string[]> {
    const cfg = await getConfiguracion()
    const u = (cfg.unidades ?? []).map((x) => String(x).trim()).filter(Boolean)
    return u.length > 0 ? u : [...UNIDADES_DEFAULT]
}

// Prefijos de folio configurados.
export async function getFolios(): Promise<IFolios> {
    const cfg = await getConfiguracion()
    return {
        orden: (cfg.folios?.orden || 'OC').toUpperCase(),
        cotizacion: (cfg.folios?.cotizacion || 'COT').toUpperCase(),
    }
}
export async function getPrefijoFolio(tipo: 'orden' | 'cotizacion'): Promise<string> {
    const f = await getFolios()
    return tipo === 'orden' ? f.orden : f.cotizacion
}

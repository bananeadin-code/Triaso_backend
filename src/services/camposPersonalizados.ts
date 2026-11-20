// Campos personalizados (INFORMATIVOS) por módulo: datos extra que la empresa define en
// Configuración. Regla de oro: NINGUNA lógica (costeo, BOM, stock, folios, claves) los usa;
// solo se capturan, se muestran y se guardan.
import { getCamposModulo } from '../models/Configuracion'

// Módulos que admiten campos personalizados (lista blanca: Configuración rechaza cualquier otro)
export const MODULOS_CAMPOS = ['materiales', 'proveedores', 'componentes', 'equipos', 'inventario', 'ordenes'] as const
export type ModuloCampos = (typeof MODULOS_CAMPOS)[number]

export const esModuloCampos = (m: unknown): m is ModuloCampos => MODULOS_CAMPOS.includes(m as ModuloCampos)

// Deja SOLO valores de campos definidos, con su tipo (numero→number, siNo→boolean, resto→string).
//  - Campos ACTIVOS: se toman de `entrada` (lo que mandó el formulario).
//  - Campos INACTIVOS (ocultos): se CONSERVA el valor `previo` del registro, porque el formulario
//    ya no los muestra y "ocultar" no debe borrar lo capturado.
//  - Valores de campos que ya no existen en la definición se descartan (basura).
export async function limpiarPersonalizados(
    modulo: ModuloCampos,
    entrada: unknown,
    previos?: unknown
): Promise<Record<string, unknown>> {
    const campos = await getCamposModulo(modulo)
    const src = entrada && typeof entrada === 'object' ? (entrada as Record<string, unknown>) : {}
    const prev = previos && typeof previos === 'object' ? (previos as Record<string, unknown>) : {}
    const out: Record<string, unknown> = {}
    for (const c of campos) {
        const v = c.activo ? src[c.id] : prev[c.id]
        if (v === undefined || v === null || v === '') continue
        if (c.tipo === 'numero') {
            const n = Number(v)
            if (!isNaN(n)) out[c.id] = n
        } else if (c.tipo === 'siNo') {
            out[c.id] = v === true || v === 'true' || v === 1 || v === '1'
        } else {
            // texto / lista / fecha, con tope de longitud. Una lista NO se restringe a sus opciones
            // actuales: si se renombra una opción, el valor viejo no debe borrarse en silencio.
            out[c.id] = String(v).slice(0, 500)
        }
    }
    return out
}

// Líneas de bitácora con lo que cambió en los datos adicionales ("Norma: — → ASTM A36")
export async function diffPersonalizados(modulo: ModuloCampos, antes: unknown, despues: unknown): Promise<string[]> {
    const campos = await getCamposModulo(modulo)
    const a = antes && typeof antes === 'object' ? (antes as Record<string, unknown>) : {}
    const d = despues && typeof despues === 'object' ? (despues as Record<string, unknown>) : {}
    const fmt = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : v === true ? 'Sí' : v === false ? 'No' : String(v))
    return campos.filter((c) => fmt(a[c.id]) !== fmt(d[c.id])).map((c) => `${c.nombre}: ${fmt(a[c.id])} → ${fmt(d[c.id])}`)
}

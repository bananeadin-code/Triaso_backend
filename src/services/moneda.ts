import { Types } from 'mongoose'
import Material from '../models/Material'

// La moneda en la que un material COTIZA (una sola). Si tiene ambos precios, la
// principal manda para el costeo; la otra queda como dato secundario (para compras).
export type MonedaPrincipal = 'mxn' | 'usd'

// Deduce la moneda principal de un material del catálogo (con respaldo para datos viejos).
export function principalDe(mat: {
    moneda?: string
    monedaPrincipal?: string
    costoUnitario?: number
    costoUSD?: number
}): MonedaPrincipal {
    const mp = mat.monedaPrincipal
    if (mp === 'mxn' || mp === 'usd') return mp
    if (mat.moneda === 'usd') return 'usd'
    if (mat.moneda === 'mxn') return 'mxn'
    // 'ambos' sin principal explícito o legacy: inferir por los costos
    const usd = Number(mat.costoUSD) || 0
    const mxn = Number(mat.costoUnitario) || 0
    return usd > 0 && mxn === 0 ? 'usd' : 'mxn'
}

// Costo EFECTIVO: solo la moneda principal cuenta; la otra queda en 0 (para no duplicar).
export function efectivo(principal: MonedaPrincipal, mxn: number, usd: number) {
    return {
        mxn: principal === 'mxn' ? Number(mxn) || 0 : 0,
        usd: principal === 'usd' ? Number(usd) || 0 : 0,
    }
}

// Mapa materialId -> moneda principal, para varios materiales de golpe.
export async function mapaPrincipal(ids: (string | Types.ObjectId | undefined)[]) {
    const limpios = [...new Set(ids.filter(Boolean).map((x) => String(x)))]
    const out = new Map<string, MonedaPrincipal>()
    if (limpios.length === 0) return out
    const mats = await Material.find({ _id: { $in: limpios } }).select('moneda monedaPrincipal costoUnitario costoUSD')
    for (const m of mats) out.set(String(m._id), principalDe(m))
    return out
}

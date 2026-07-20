import { Types } from 'mongoose'
import Componente, { IVariacion } from '../models/Componente'
import Material from '../models/Material'

// Propaga el costo de un material del catálogo a TODOS los componentes que lo usan.
export async function sincComponentesDesdeMaterial(
    materialId: string | Types.ObjectId,
    costoMXN: number,
    costoUSD: number
) {
    const comps = await Componente.find({ 'variaciones.materiales.material': materialId })
    for (const c of comps) {
        let cambiado = false
        c.variaciones.forEach((v) =>
            v.materiales.forEach((m) => {
                if (m.material && String(m.material) === String(materialId)) {
                    m.costoMXN = costoMXN
                    m.costoUSD = costoUSD
                    m.importeMXN = +(m.cantidad * costoMXN).toFixed(2)
                    m.importeUSD = +(m.cantidad * costoUSD).toFixed(2)
                    cambiado = true
                }
            })
        )
        if (cambiado) await c.save()
    }
}

// Propaga a TODO el sistema (catálogo + componentes) el costo MXN editado desde una orden.
// Conserva el costo USD del material (las órdenes se manejan en MXN).
export async function propagarCostoDesdeOrden(materialId: string | Types.ObjectId, costoMXN: number) {
    const mat = await Material.findById(materialId)
    if (!mat) return
    mat.costoUnitario = costoMXN
    mat.importeMXN = costoMXN
    await mat.save()
    await sincComponentesDesdeMaterial(materialId, costoMXN, mat.costoUSD)
}

// Al editar un componente, empareja el catálogo maestro con los costos de sus materiales
// y propaga a todos los demás componentes que usan los mismos materiales.
export async function sincMaterialesDesdeComponente(variaciones: IVariacion[]) {
    const mapa = new Map<string, { costoMXN: number; costoUSD: number }>()
    for (const v of variaciones ?? []) {
        for (const m of v.materiales ?? []) {
            if (m.material) {
                mapa.set(String(m.material), { costoMXN: Number(m.costoMXN) || 0, costoUSD: Number(m.costoUSD) || 0 })
            }
        }
    }
    for (const [id, { costoMXN, costoUSD }] of mapa) {
        await Material.updateOne(
            { _id: id },
            { costoUnitario: costoMXN, costoUSD, importeMXN: costoMXN, importeUSD: costoUSD }
        )
        await sincComponentesDesdeMaterial(id, costoMXN, costoUSD)
    }
}

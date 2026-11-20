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

// Propaga a TODO el sistema (catálogo + componentes) un costo editado fuera del catálogo
// (desde una orden de compra o desde el detalle de una cotización).
// MXN y USD son INDEPENDIENTES: se actualiza el que venga definido y el otro se conserva,
// así ninguno queda atado al otro por una paridad automática.
export async function propagarCostoDesdeOrden(
    materialId: string | Types.ObjectId,
    costoMXN?: number,
    costoUSD?: number
) {
    const mat = await Material.findById(materialId)
    if (!mat) return

    if (costoMXN !== undefined && !isNaN(Number(costoMXN))) {
        mat.costoUnitario = Number(costoMXN)
        mat.importeMXN = Number(costoMXN)
    }
    if (costoUSD !== undefined && !isNaN(Number(costoUSD))) {
        mat.costoUSD = Number(costoUSD)
        mat.importeUSD = Number(costoUSD)
    }
    await mat.save()

    await sincComponentesDesdeMaterial(materialId, mat.costoUnitario, mat.costoUSD)
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

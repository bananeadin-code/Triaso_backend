import BitacoraUsuario, { AccionBitacora } from '../models/BitacoraUsuario'

// Registros que se conservan (los más recientes)
export const MAX_BITACORA = 200

const etiqueta = (u: { nombre: string; email: string }) => `${u.nombre} (${u.email})`

export async function registrarBitacora(
    actor: { nombre: string; email: string },
    accion: AccionBitacora,
    afectado: { nombre: string; email: string },
    detalle: string[] = []
) {
    try {
        await BitacoraUsuario.create({ actor: etiqueta(actor), accion, afectado: etiqueta(afectado), detalle })
        const sobrantes = await BitacoraUsuario.find().sort({ createdAt: -1 }).skip(MAX_BITACORA).select('_id')
        if (sobrantes.length > 0) await BitacoraUsuario.deleteMany({ _id: { $in: sobrantes.map((s) => s._id) } })
    } catch {
        // La bitácora nunca debe tumbar la operación principal
    }
}

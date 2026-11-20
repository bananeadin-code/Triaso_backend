import { Types } from 'mongoose'
import MovimientoInventario from '../models/MovimientoInventario'
import Material from '../models/Material'

interface DatosMovimiento {
    material: string | Types.ObjectId
    clave?: string
    concepto?: string
    tipo: 'entrada' | 'salida' | 'ajuste'
    cantidad: number // magnitud (positiva)
    saldoAnterior: number
    saldoNuevo: number
    documento: string
    motivo: string
    usuario: string
}

// Registra UN movimiento de kárdex. Nunca lanza: el rastro es un complemento,
// jamás debe tumbar la operación real (recepción / salida / ajuste).
export async function registrarMovimiento(datos: DatosMovimiento) {
    try {
        let { clave, concepto } = datos
        if (!clave || !concepto) {
            const mat = await Material.findById(datos.material).select('clave concepto')
            clave = clave || mat?.clave || ''
            concepto = concepto || mat?.concepto || ''
        }
        await MovimientoInventario.create({
            material: datos.material,
            clave,
            concepto,
            tipo: datos.tipo,
            cantidad: Math.abs(datos.cantidad),
            saldoAnterior: datos.saldoAnterior,
            saldoNuevo: datos.saldoNuevo,
            documento: datos.documento,
            motivo: datos.motivo,
            usuario: datos.usuario || 'Sistema',
        })
    } catch (e) {
        console.error('No se pudo registrar el movimiento de kárdex:', e)
    }
}

import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import Cotizacion from '../models/Cotizacion'

// Utilidades de limpieza para los scripts de verificación.
// Borra SOLO la cotización de prueba indicada, directo en BD — sin usar
// "limpiar canceladas", que también borraría las canceladas reales del usuario.
export async function borrarCotizacionQA(id: string) {
    if (mongoose.connection.readyState !== 1) await connectDB()
    await Cotizacion.deleteOne({ _id: id })
}

export async function cerrarBD() {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect()
}

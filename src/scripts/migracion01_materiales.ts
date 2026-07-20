import 'dotenv/config'
import colors from 'colors'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'

// Migración: catálogo maestro de materiales
//  - renombra 'costo' -> 'costoUnitario'
//  - elimina 'categorias' (categorías adicionales) y 'ubicacion'
// Uso: npx ts-node src/scripts/migracion01_materiales.ts
const migrar = async () => {
    await connectDB()
    const col = mongoose.connection.collection('materials')

    const r1 = await col.updateMany({ costo: { $exists: true } }, { $rename: { costo: 'costoUnitario' } })
    const r2 = await col.updateMany(
        { $or: [{ categorias: { $exists: true } }, { ubicacion: { $exists: true } }] },
        { $unset: { categorias: '', ubicacion: '' } }
    )

    console.log(colors.green.bold(`Renombrados costo->costoUnitario: ${r1.modifiedCount}`))
    console.log(colors.green.bold(`Limpiados categorias/ubicacion: ${r2.modifiedCount}`))
    await mongoose.disconnect()
}

migrar()

// Limpieza única de los lotes de PRUEBA de la importación de BOM (ya deshechos) y de lo que
// dejaron: entradas de bitácora y unidades que ya no usa ningún componente.
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import ImportacionLote from '../models/ImportacionLote'
import Historial from '../models/Historial'
import Componente from '../models/Componente'
import { getConfiguracion } from '../models/Configuracion'

async function main() {
    await connectDB()
    const lotes = await ImportacionLote.find({ estado: { $in: ['deshecho', 'fallido'] } }).lean()
    const folios = lotes.map((l) => l.folio)
    const unidades = [...new Set(lotes.flatMap((l) => l.unidadesAgregadas ?? []))]
    const h = await Historial.deleteMany({ tipo: 'importacion', entidad: { $regex: `^(${folios.join('|') || 'NADA'}) ` } })
    // Validaciones hechas durante la prueba (última hora) sobre registros que ya no existen
    const hv = await Historial.deleteMany({ tipo: 'importacion', entidad: /^Validación de /, createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } })
    console.log(`Validaciones de prueba quitadas de la bitácora: ${hv.deletedCount}`)
    const l = await ImportacionLote.deleteMany({ _id: { $in: lotes.map((x) => x._id) } })
    const cfg = await getConfiguracion()
    const quitar: string[] = []
    for (const u of unidades) if (!(await Componente.exists({ 'variaciones.materiales.unidad': u }))) quitar.push(u)
    cfg.unidades = (cfg.unidades ?? []).filter((u) => !quitar.includes(u))
    await cfg.save()
    console.log(`Lotes de prueba borrados: ${l.deletedCount} (${folios.join(', ')}) · bitácora: ${h.deletedCount} · unidades quitadas: ${quitar.join(', ') || 'ninguna'}`)
    console.log('Unidades actuales:', cfg.unidades.join(', '))
    await mongoose.disconnect()
}
main().catch((e) => {
    console.error(e)
    process.exit(1)
})

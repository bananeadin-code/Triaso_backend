import mongoose, { Document, Schema } from 'mongoose'
import { getConfiguracion } from './Configuracion'

// Bitácora del tipo de cambio (MXN por USD). Cada registro es el valor vigente
// a partir de su fecha. El valor "de hoy" es el registro más reciente.
// Las cotizaciones guardan una referencia al registro que usaron, para poder
// editar el pasado y que su conversión se recalcule.
export interface IParidad extends Document {
    valor: number // MXN por 1 USD
    fecha: Date // a partir de cuándo aplica
    origen: 'manual' | 'api' | 'config'
    nota: string
    creadoPor: string
}

const ParidadSchema: Schema = new Schema(
    {
        valor: { type: Number, required: true, min: 0 },
        fecha: { type: Date, required: true, default: Date.now },
        origen: { type: String, enum: ['manual', 'api', 'config'], default: 'manual' },
        nota: { type: String, default: '' },
        creadoPor: { type: String, default: 'Sistema' },
    },
    { timestamps: true }
)
ParidadSchema.index({ fecha: -1 })

const Paridad = mongoose.model<IParidad>('Paridad', ParidadSchema)
export default Paridad

// Rango [inicio, fin) del día de una fecha
function limitesDelDia(d: Date) {
    const inicio = new Date(d)
    inicio.setHours(0, 0, 0, 0)
    const fin = new Date(inicio)
    fin.setDate(fin.getDate() + 1)
    return { inicio, fin }
}

// Registro de paridad vigente (el más reciente). Si no hay ninguno, crea uno
// a partir del valor de Configuración (semilla), para que siempre exista.
export async function getParidadVigente(): Promise<IParidad> {
    let p = await Paridad.findOne().sort({ fecha: -1, createdAt: -1 })
    if (!p) {
        const cfg = await getConfiguracion()
        p = await Paridad.create({ valor: cfg.tipoCambio || 20, fecha: new Date(), origen: 'config', creadoPor: 'Sistema' })
    }
    return p
}

// Crea o actualiza el registro de HOY (un solo registro por día). Devuelve el registro.
export async function upsertParidadHoy(valor: number, origen: IParidad['origen'], usuario: string, nota = ''): Promise<IParidad> {
    const { inicio, fin } = limitesDelDia(new Date())
    let p = await Paridad.findOne({ fecha: { $gte: inicio, $lt: fin } }).sort({ fecha: -1 })
    if (p) {
        p.valor = valor
        p.origen = origen
        p.creadoPor = usuario
        if (nota) p.nota = nota
        await p.save()
    } else {
        p = await Paridad.create({ valor, fecha: new Date(), origen, creadoPor: usuario, nota })
    }
    return p
}

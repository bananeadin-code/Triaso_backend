import mongoose from 'mongoose'
import colors from 'colors'

export const connectDB = async () => {
    try {
        const uri = process.env.MONGODB_URI
        if (!uri) {
            throw new Error('Falta la variable de entorno MONGODB_URI')
        }
        const { connection } = await mongoose.connect(uri)
        const url = `${connection.host}:${connection.port}`
        console.log(colors.cyan.bold(`MongoDB conectado en ${url}`))
    } catch (error) {
        console.log(colors.red.bold('Error al conectar a MongoDB'))
        console.log(error)
        process.exit(1)
    }
}

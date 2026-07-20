import 'dotenv/config'
import colors from 'colors'
import server from './server'
import { connectDB } from './config/db'

const port = process.env.PORT || 4000

const iniciar = async () => {
    await connectDB()
    server.listen(port, () => {
        console.log(colors.green.bold(`Servidor Triaso corriendo en el puerto ${port}`))
    })
}

iniciar()

import { CorsOptions } from 'cors'

export const corsConfig: CorsOptions = {
    origin: function (origin, callback) {
        const whitelist = [process.env.FRONTEND_URL]

        // Permite herramientas sin origin (Postman, curl) en desarrollo
        if (process.env.NODE_ENV !== 'production') {
            whitelist.push(undefined as unknown as string)
        }

        if (!origin || whitelist.includes(origin)) {
            callback(null, true)
        } else {
            callback(new Error('Error de CORS: origen no permitido'))
        }
    },
}

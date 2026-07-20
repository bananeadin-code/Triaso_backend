import express from 'express'
import cors from 'cors'
import { corsConfig } from './config/cors'
import authRoutes from './routes/authRoutes'
import proveedorRoutes from './routes/proveedorRoutes'
import materialRoutes from './routes/materialRoutes'
import componenteRoutes from './routes/componenteRoutes'
import equipoRoutes from './routes/equipoRoutes'
import inventarioRoutes from './routes/inventarioRoutes'
import ordenCompraRoutes from './routes/ordenCompraRoutes'
import recomendacionRoutes from './routes/recomendacionRoutes'
import historialRoutes from './routes/historialRoutes'
import cotizacionRoutes from './routes/cotizacionRoutes'
import reporteRoutes from './routes/reporteRoutes'
import usuarioRoutes from './routes/usuarioRoutes'

const app = express()

// CORS
app.use(cors(corsConfig))

// Leer JSON
app.use(express.json())

// Health check
app.get('/api', (req, res) => {
    res.json({ ok: true, servicio: 'Triaso BOM API', version: '1.0.0' })
})

// Rutas
app.use('/api/auth', authRoutes)
app.use('/api/proveedores', proveedorRoutes)
app.use('/api/materiales', materialRoutes)
app.use('/api/componentes', componenteRoutes)
app.use('/api/equipos', equipoRoutes)
app.use('/api/inventario', inventarioRoutes)
app.use('/api/ordenes', ordenCompraRoutes)
app.use('/api/recomendaciones', recomendacionRoutes)
app.use('/api/historial', historialRoutes)
app.use('/api/cotizaciones', cotizacionRoutes)
app.use('/api/reportes', reporteRoutes)
app.use('/api/usuarios', usuarioRoutes)

export default app

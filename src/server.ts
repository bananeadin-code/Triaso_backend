import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
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
import configuracionRoutes from './routes/configuracionRoutes'
import movimientoRoutes from './routes/movimientoRoutes'
import paridadRoutes from './routes/paridadRoutes'
import importacionRoutes from './routes/importacionRoutes'

const app = express()

// Detrás de un proxy (Nginx/IIS/balanceador) la IP real llega en X-Forwarded-For.
// TRUST_PROXY = número de saltos de proxy de confianza (ej. 1). Sin proxy se deja en 0:
// así nadie puede falsear su IP con esa cabecera para burlar el límite de intentos de login.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 0))

// Cabeceras de seguridad estándar (oculta X-Powered-By, nosniff, HSTS, anti-clickjacking…).
// CORP en cross-origin: el front puede vivir en otro origen y descargar los PDF de la API.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))

// CORS
app.use(cors(corsConfig))

// Leer JSON. Límite general de 200 KB; la importación de Excel (lotes grandes) admite hasta 5 MB.
// La ruta específica va ANTES: si ya parseó el cuerpo, el parser general lo deja pasar.
app.use('/api/proveedores/importar', express.json({ limit: '5mb' }))
app.use('/api/importaciones/bom', express.json({ limit: '5mb' }))
app.use(express.json({ limit: '200kb' }))

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
app.use('/api/configuracion', configuracionRoutes)
app.use('/api/movimientos', movimientoRoutes)
app.use('/api/paridad', paridadRoutes)
app.use('/api/importaciones', importacionRoutes)

export default app

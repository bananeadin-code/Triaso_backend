import { Router } from 'express'
import { ReporteController } from '../controllers/ReporteController'
import { authenticate, checkModulo, checkPermiso } from '../middleware/auth'

const router = Router()

// Descargar reportes: requiere el permiso generarReportes + acceso de lectura al módulo
router.use(authenticate, checkPermiso('generarReportes'))

router.get('/inventario', checkModulo('inventario', 'lectura'), ReporteController.inventario)
router.get('/materiales', checkModulo('materiales', 'lectura'), ReporteController.materiales)
router.get('/proveedores', checkModulo('proveedores', 'lectura'), ReporteController.proveedores)
router.get('/ordenes', checkModulo('ordenes', 'lectura'), ReporteController.ordenes)
router.get('/equipo/:id', checkModulo('equipos', 'lectura'), ReporteController.equipo)
router.get('/cotizacion/:id', checkModulo('cotizaciones', 'lectura'), ReporteController.cotizacion)

export default router

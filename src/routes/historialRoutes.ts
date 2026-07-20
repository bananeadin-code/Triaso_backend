import { Router } from 'express'
import { HistorialController } from '../controllers/HistorialController'
import { authenticate, checkModulo, checkPermiso } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Ver el historial de cambios (módulo historial)
router.get('/', checkModulo('historial', 'lectura'), HistorialController.obtenerHistorial)

// Limpiar el historial — requiere el permiso limpiarHistoriales
router.delete('/', checkModulo('historial', 'escritura'), checkPermiso('limpiarHistoriales'), HistorialController.limpiarHistorial)

export default router

import { Router } from 'express'
import { HistorialController } from '../controllers/HistorialController'
import { authenticate, checkModulo } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Ver el historial de cambios (módulo historial). No hay borrado: la bitácora se conserva.
router.get('/', checkModulo('historial', 'lectura'), HistorialController.obtenerHistorial)

export default router

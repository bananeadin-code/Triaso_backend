import { Router } from 'express'
import { MovimientoController } from '../controllers/MovimientoController'
import { authenticate, checkModulo } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// El kárdex es parte del inventario: lo ve quien tiene lectura de inventario.
router.get('/', checkModulo('inventario', 'lectura'), MovimientoController.obtener)

export default router

import { Router } from 'express'
import { ParidadController } from '../controllers/ParidadController'
import { authenticate, soloGestion } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Lectura: cualquier usuario autenticado (para mostrar el valor vigente / bitácora)
router.get('/', ParidadController.obtener)

// Escritura: solo administración (admin / operador)
router.post('/', soloGestion, ParidadController.crear)
router.post('/traer-hoy', soloGestion, ParidadController.traerHoy)
router.put('/:id', soloGestion, ParidadController.actualizar)
router.delete('/:id', soloGestion, ParidadController.eliminar)

export default router

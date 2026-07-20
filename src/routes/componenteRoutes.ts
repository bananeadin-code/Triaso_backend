import { Router } from 'express'
import { body } from 'express-validator'
import { ComponenteController } from '../controllers/ComponenteController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, checkModulo } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Lectura de componentes
router.get('/', checkModulo('componentes', 'lectura'), ComponenteController.obtenerComponentes)
router.get('/:id', checkModulo('componentes', 'lectura'), ComponenteController.obtenerComponentePorId)

// Escritura de componentes
router.post(
    '/',
    checkModulo('componentes', 'escritura'),
    body('concepto').notEmpty().withMessage('El concepto es obligatorio'),
    handleInputErrors,
    ComponenteController.crearComponente
)

router.put('/:id', checkModulo('componentes', 'escritura'), ComponenteController.actualizarComponente)
router.delete('/:id', checkModulo('componentes', 'escritura'), ComponenteController.eliminarComponente)

export default router

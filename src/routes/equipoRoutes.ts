import { Router } from 'express'
import { body } from 'express-validator'
import { EquipoController } from '../controllers/EquipoController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, checkModulo } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Lectura del BOM de equipos
router.get('/', checkModulo('equipos', 'lectura'), EquipoController.obtenerEquipos)
router.get('/:id', checkModulo('equipos', 'lectura'), EquipoController.obtenerEquipoPorId)

// Escritura del BOM de equipos
router.post(
    '/',
    checkModulo('equipos', 'escritura'),
    body('nombre').notEmpty().withMessage('El nombre del equipo es obligatorio'),
    handleInputErrors,
    EquipoController.crearEquipo
)

router.put('/:id', checkModulo('equipos', 'escritura'), EquipoController.actualizarEquipo)
router.delete('/:id', checkModulo('equipos', 'escritura'), EquipoController.eliminarEquipo)

export default router

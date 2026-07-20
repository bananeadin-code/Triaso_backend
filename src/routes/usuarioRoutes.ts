import { Router } from 'express'
import { body } from 'express-validator'
import { UsuarioController } from '../controllers/UsuarioController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, soloAdmin } from '../middleware/auth'
import { ROLES } from '../config/permisos'

const router = Router()

// Módulo exclusivo del administrador
router.use(authenticate, soloAdmin)

router.get('/', UsuarioController.listar)

router.post(
    '/',
    body('nombre').notEmpty().withMessage('El nombre es obligatorio'),
    body('email').isEmail().withMessage('Correo no válido'),
    body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
    body('rol').isIn(ROLES).withMessage('Rol no válido'),
    handleInputErrors,
    UsuarioController.crear
)

router.put('/:id', UsuarioController.actualizar)
router.delete('/:id', UsuarioController.eliminar)

export default router

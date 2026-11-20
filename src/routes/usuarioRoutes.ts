import { Router } from 'express'
import { body, param } from 'express-validator'
import { UsuarioController } from '../controllers/UsuarioController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, soloAdmin } from '../middleware/auth'
import { ROLES } from '../config/permisos'

const router = Router()

// Módulo exclusivo del administrador
router.use(authenticate, soloAdmin)

router.get('/', UsuarioController.listar)
router.get('/bitacora', UsuarioController.bitacora)

router.post(
    '/',
    body('nombre').notEmpty().withMessage('El nombre es obligatorio'),
    body('email').isEmail().withMessage('Correo no válido'),
    body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
    body('rol').isIn(ROLES).withMessage('Rol no válido'),
    handleInputErrors,
    UsuarioController.crear
)

const idValido = [param('id').isMongoId().withMessage('ID no válido'), handleInputErrors]

router.put(
    '/:id',
    idValido,
    body('rol').optional().isIn(ROLES).withMessage('Rol no válido'),
    body('activo').optional().isBoolean({ strict: true }).withMessage('Estado no válido'),
    handleInputErrors,
    UsuarioController.actualizar
)
router.put(
    '/:id/password',
    idValido,
    body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
    handleInputErrors,
    UsuarioController.restablecerPassword
)
router.delete('/:id', idValido, UsuarioController.eliminar)

export default router

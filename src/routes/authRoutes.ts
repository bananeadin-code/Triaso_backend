import { Router } from 'express'
import { body } from 'express-validator'
import { AuthController } from '../controllers/AuthController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate } from '../middleware/auth'

const router = Router()

// Login
router.post(
    '/login',
    body('email').isEmail().withMessage('Correo no válido'),
    body('password').notEmpty().withMessage('La contraseña es obligatoria'),
    handleInputErrors,
    AuthController.login
)

// Perfil del usuario autenticado (incluye sus accesos)
router.get('/perfil', authenticate, AuthController.perfil)

// El propio usuario edita su nombre (y su correo, si es admin)
router.put(
    '/perfil',
    authenticate,
    body('nombre').notEmpty().withMessage('El nombre es obligatorio'),
    body('email').optional().isEmail().withMessage('Correo no válido'),
    handleInputErrors,
    AuthController.actualizarPerfil
)

// El propio usuario cambia su contraseña (verifica la actual)
router.put(
    '/perfil/password',
    authenticate,
    body('actual').notEmpty().withMessage('La contraseña actual es obligatoria'),
    body('nueva').isLength({ min: 6 }).withMessage('La nueva contraseña debe tener al menos 6 caracteres'),
    handleInputErrors,
    AuthController.cambiarPassword
)

export default router

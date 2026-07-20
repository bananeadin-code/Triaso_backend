import { Router } from 'express'
import { body } from 'express-validator'
import { ProveedorController } from '../controllers/ProveedorController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, checkModulo } from '../middleware/auth'

const router = Router()

// Todas requieren estar autenticado
router.use(authenticate)

// Lectura de proveedores
router.get('/', checkModulo('proveedores', 'lectura'), ProveedorController.obtenerProveedores)
router.get('/:id', checkModulo('proveedores', 'lectura'), ProveedorController.obtenerProveedorPorId)

// Escritura de proveedores
router.post(
    '/',
    checkModulo('proveedores', 'escritura'),
    body('codigo').notEmpty().withMessage('El código es obligatorio'),
    body('razonSocial').notEmpty().withMessage('La razón social es obligatoria'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Correo no válido'),
    handleInputErrors,
    ProveedorController.crearProveedor
)

router.put(
    '/:id',
    checkModulo('proveedores', 'escritura'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Correo no válido'),
    handleInputErrors,
    ProveedorController.actualizarProveedor
)

router.delete('/:id', checkModulo('proveedores', 'escritura'), ProveedorController.eliminarProveedor)

export default router

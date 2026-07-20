import { Router } from 'express'
import { body } from 'express-validator'
import { InventarioController } from '../controllers/InventarioController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, checkModulo } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Lectura del inventario
router.get('/', checkModulo('inventario', 'lectura'), InventarioController.obtenerInventario)

// Escritura del inventario (almacenista / operador / admin)
router.post(
    '/',
    checkModulo('inventario', 'escritura'),
    body('material').isMongoId().withMessage('Material no válido'),
    body('cantidad').isFloat({ min: 0 }).withMessage('La cantidad debe ser un número positivo'),
    handleInputErrors,
    InventarioController.agregarAlInventario
)

router.put(
    '/:id',
    checkModulo('inventario', 'escritura'),
    body('cantidad').optional().isFloat({ min: 0 }).withMessage('La cantidad debe ser un número positivo'),
    handleInputErrors,
    InventarioController.actualizarInventario
)

router.delete('/:id', checkModulo('inventario', 'escritura'), InventarioController.eliminarDelInventario)

export default router

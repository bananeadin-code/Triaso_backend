import { Router } from 'express'
import { body } from 'express-validator'
import { MaterialController } from '../controllers/MaterialController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, checkModulo } from '../middleware/auth'
import { CATEGORIA_IDS } from '../config/categorias'

const router = Router()

router.use(authenticate)

// Catálogo de categorías (para selects del front)
router.get('/categorias', checkModulo('materiales', 'lectura'), MaterialController.obtenerCategorias)

// Lectura del catálogo de materiales
router.get('/', checkModulo('materiales', 'lectura'), MaterialController.obtenerMateriales)
router.get('/:id', checkModulo('materiales', 'lectura'), MaterialController.obtenerMaterialPorId)

// Validaciones compartidas de creación/edición
const validarMaterial = [
    body('concepto').notEmpty().withMessage('El concepto es obligatorio'),
    body('categoriaPrincipal').isIn(CATEGORIA_IDS).withMessage('Categoría principal no válida'),
    body('proveedorPrincipal').isMongoId().withMessage('Proveedor principal no válido'),
    body('costoUnitario').isFloat({ min: 0 }).withMessage('El costo unitario debe ser un número positivo'),
    body('costoUSD').optional().isFloat({ min: 0 }).withMessage('El costo USD debe ser un número positivo'),
]

// Escritura del catálogo de materiales
router.post('/', checkModulo('materiales', 'escritura'), validarMaterial, handleInputErrors, MaterialController.crearMaterial)
router.put('/:id', checkModulo('materiales', 'escritura'), handleInputErrors, MaterialController.actualizarMaterial)
router.delete('/:id', checkModulo('materiales', 'escritura'), MaterialController.eliminarMaterial)

export default router

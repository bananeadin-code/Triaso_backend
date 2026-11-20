import { Router } from 'express'
import { body } from 'express-validator'
import { ConfiguracionController } from '../controllers/ConfiguracionController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, checkModulo, soloGestion } from '../middleware/auth'
import { esModuloCampos } from '../services/camposPersonalizados'

const router = Router()

router.use(authenticate)

// Lectura: cualquier usuario autenticado (se usa para consolidar totales)
router.get('/', ConfiguracionController.obtener)

// Campos personalizados ACTIVOS de un módulo (para sus formularios y tablas).
// Requiere poder VER ese módulo; un módulo fuera de la lista blanca da 404.
router.get(
    '/campos/:modulo',
    (req, res, next) => {
        const modulo = req.params.modulo
        if (!esModuloCampos(modulo)) return res.status(404).json({ error: 'Módulo sin campos personalizados' })
        return checkModulo(modulo, 'lectura')(req, res, next)
    },
    ConfiguracionController.obtenerCamposModulo
)

// Escritura: solo administración (admin / operador)
router.put(
    '/',
    soloGestion,
    body('tipoCambio').optional().isFloat({ min: 0 }).withMessage('Tipo de cambio no válido'),
    handleInputErrors,
    ConfiguracionController.actualizar
)

export default router

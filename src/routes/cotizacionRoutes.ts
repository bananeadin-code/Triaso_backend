import { Router } from 'express'
import { body } from 'express-validator'
import { CotizacionController } from '../controllers/CotizacionController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, checkModulo } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Lectura: incluye al almacenista (solo ver tabla + detalle)
router.get('/', checkModulo('cotizaciones', 'lectura'), CotizacionController.obtenerCotizaciones)
router.get('/:id', checkModulo('cotizaciones', 'lectura'), CotizacionController.detalleCotizacion)

// Crear/cotizar
router.post(
    '/',
    checkModulo('cotizaciones', 'escritura'),
    body('equipo').isMongoId().withMessage('Equipo no válido'),
    handleInputErrors,
    CotizacionController.crearCotizacion
)

// Registrar órdenes borrador
router.post('/:id/ordenes', checkModulo('cotizaciones', 'escritura'), CotizacionController.registrarOrdenes)

// Declarar salida (descuenta del inventario) — solo si todo está completo
// Declarar salida es una EDICIÓN de la cotización (cambia su estado), no una alta
router.post('/:id/salida', checkModulo('cotizaciones', 'editar'), CotizacionController.declararSalida)
router.put('/:id', checkModulo('cotizaciones', 'escritura'), CotizacionController.actualizarCotizacion)

// Editar inline el costo (catálogo) de un material desde el detalle de la cotización
router.put('/:id/costo-material', checkModulo('cotizaciones', 'escritura'), CotizacionController.actualizarCostoMaterial)

router.delete('/:id', checkModulo('cotizaciones', 'escritura'), CotizacionController.cancelarCotizacion)

export default router

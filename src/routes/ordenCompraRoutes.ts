import { Router } from 'express'
import { body } from 'express-validator'
import { OrdenCompraController } from '../controllers/OrdenCompraController'
import { handleInputErrors } from '../middleware/validation'
import { authenticate, checkModulo, checkPermiso } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Lectura de órdenes
router.get('/', checkModulo('ordenes', 'lectura'), OrdenCompraController.obtenerOrdenes)
router.get('/:id', checkModulo('ordenes', 'lectura'), OrdenCompraController.obtenerOrdenPorId)

// Escritura de órdenes
router.post(
    '/',
    checkModulo('ordenes', 'escritura'),
    body('proveedor').isMongoId().withMessage('Proveedor no válido'),
    body('items').isArray({ min: 1 }).withMessage('La orden debe tener al menos un material'),
    handleInputErrors,
    OrdenCompraController.crearOrden
)

// Limpiar órdenes completadas con +90 días — requiere el permiso limpiarHistoriales
router.delete(
    '/limpiar/completadas',
    checkModulo('ordenes', 'escritura'),
    checkPermiso('limpiarHistoriales'),
    OrdenCompraController.limpiarCompletadas
)

router.put('/:id', checkModulo('ordenes', 'escritura'), OrdenCompraController.actualizarOrden)

// Marcar como enviada (con opción de disparar el correo)
router.put('/:id/enviar', checkModulo('ordenes', 'escritura'), OrdenCompraController.marcarEnviada)

// Registrar faltantes (genera recomendaciones y recalcula el total)
router.put('/:id/faltantes', checkModulo('ordenes', 'escritura'), OrdenCompraController.registrarFaltantes)

// Confirmar recepción (fija costo real y suma stock al inventario)
router.put('/:id/confirmar', checkModulo('ordenes', 'escritura'), OrdenCompraController.confirmarRecepcion)

// Descargar el ticket/factura en PDF
router.get('/:id/pdf', checkModulo('ordenes', 'lectura'), OrdenCompraController.descargarPDF)

router.delete('/:id', checkModulo('ordenes', 'escritura'), OrdenCompraController.eliminarOrden)

export default router

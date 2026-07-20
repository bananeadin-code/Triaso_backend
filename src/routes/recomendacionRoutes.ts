import { Router } from 'express'
import { OrdenCompraController } from '../controllers/OrdenCompraController'
import { authenticate, checkModulo } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Lista de recomendaciones pendientes (pestaña de órdenes)
router.get('/', checkModulo('ordenes', 'lectura'), OrdenCompraController.listarRecomendaciones)

// Finalizar: crea una orden a partir de la recomendación
router.post('/:id/finalizar', checkModulo('ordenes', 'escritura'), OrdenCompraController.finalizarRecomendacion)

// Descartar recomendación
router.delete('/:id', checkModulo('ordenes', 'escritura'), OrdenCompraController.eliminarRecomendacion)

export default router

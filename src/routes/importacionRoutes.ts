import { Router, type Request, type Response, type NextFunction } from 'express'
import { ImportacionController } from '../controllers/ImportacionController'
import { authenticate, checkModulo } from '../middleware/auth'
import { puedeOperacion, type Modulo, type Operacion, type Rol } from '../config/permisos'

const router = Router()
router.use(authenticate)

// Importar un BOM crea registros en cuatro catálogos: exige poder CREAR en todos ellos
const exigir = (pares: [Modulo, Operacion][]) => (req: Request, res: Response, next: NextFunction) => {
    const u = req.usuario!
    const ctx = { rol: u.rol as Rol, accesosPersonalizados: u.accesosPersonalizados, accesos: u.accesos }
    const falta = pares.find(([m, op]) => !puedeOperacion(ctx, m, op))
    if (falta) return res.status(403).json({ error: `Para importar necesitas permiso de ${falta[1]} en ${falta[0]}` })
    next()
}
const PARA_IMPORTAR: [Modulo, Operacion][] = [
    ['equipos', 'crear'],
    ['componentes', 'crear'],
    ['materiales', 'crear'],
    ['proveedores', 'crear'],
]

router.post('/bom/analizar', exigir(PARA_IMPORTAR), ImportacionController.analizarBOM)
router.post('/bom/aplicar', exigir(PARA_IMPORTAR), ImportacionController.aplicarBOM)

// Historial de lotes (quien ve equipos puede ver de dónde salieron)
router.get('/', checkModulo('equipos', 'ver'), ImportacionController.listarLotes)
router.get('/:id/deshacer', exigir([...PARA_IMPORTAR, ['equipos', 'eliminar']]), ImportacionController.revisarDeshacer)
router.post('/:id/deshacer', exigir([...PARA_IMPORTAR, ['equipos', 'eliminar']]), ImportacionController.deshacer)

// Validar registros "por validar" (el controlador revisa el permiso de editar del catálogo)
router.post('/validar', ImportacionController.validar)

export default router

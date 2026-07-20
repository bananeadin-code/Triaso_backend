// ===== Fuente ÚNICA de verdad de roles, módulos y permisos =====
// La usan: el modelo Usuario, el middleware (checkModulo/checkPermiso), el endpoint
// /auth/perfil (para que el front filtre nav, guarde rutas y muestre/oculte acciones)
// y el módulo de Usuarios (para las descripciones de cada rol).

export const ROLES = ['admin', 'operador', 'cotizador', 'comprador', 'capturista', 'almacenista'] as const
export type Rol = (typeof ROLES)[number]

// Módulos de datos (con endpoints protegidos). El "panel" y el "perfil" están siempre disponibles.
export const MODULOS = [
    'equipos',
    'componentes',
    'materiales',
    'proveedores',
    'inventario',
    'cotizaciones',
    'ordenes',
    'historial',
    'usuarios',
] as const
export type Modulo = (typeof MODULOS)[number]

export type Nivel = 'lectura' | 'escritura' | 'total'
const NIVEL_VAL: Record<Nivel, number> = { lectura: 1, escritura: 2, total: 3 }

export type Permiso = 'limpiarHistoriales' | 'generarReportes'

// Variante de panel/dashboard que ve cada rol
export type PanelTipo = 'completo' | 'cotizador' | 'comprador' | 'capturista' | 'almacenista'

export interface RolDef {
    clave: Rol
    nombre: string
    descripcion: string // qué hace / qué soluciona (se muestra al registrar)
    todo: boolean // acceso total a todos los módulos de datos
    panel: PanelTipo
    nav: Modulo[] // qué módulos aparecen en el menú
    acceso: Partial<Record<Modulo, Nivel>> // permiso por endpoint (para roles no-"todo")
}

export const ROL_DEFS: Record<Rol, RolDef> = {
    admin: {
        clave: 'admin',
        nombre: 'Administrador',
        descripcion:
            'Control total del sistema, incluida la gestión de usuarios (alta, baja, roles y permisos). Es el único que administra las cuentas de acceso.',
        todo: true,
        panel: 'completo',
        nav: ['equipos', 'componentes', 'materiales', 'proveedores', 'inventario', 'cotizaciones', 'ordenes', 'historial', 'usuarios'],
        acceso: {},
    },
    operador: {
        clave: 'operador',
        nombre: 'Operador general',
        descripcion:
            'Acceso operativo total: catálogos, BOM, inventario, cotizaciones, órdenes y reportes. Igual que el administrador, pero sin la gestión de usuarios.',
        todo: true,
        panel: 'completo',
        nav: ['equipos', 'componentes', 'materiales', 'proveedores', 'inventario', 'cotizaciones', 'ordenes', 'historial'],
        acceso: {},
    },
    cotizador: {
        clave: 'cotizador',
        nombre: 'Cotizador',
        descripcion:
            'Genera cotizaciones de equipos (creación o reparación) y gestiona las órdenes de compra sobre el BOM completo. El inventario lo alimenta otra persona, pero el sistema lo usa por dentro para detectar faltantes y sugerir órdenes.',
        todo: false,
        panel: 'cotizador',
        nav: ['equipos', 'cotizaciones', 'ordenes'],
        acceso: {
            // Ve el BOM completo para cotizar, pero NO puede alterar la composición
            // de un equipo (agregar/quitar componentes) ni crearlos/eliminarlos.
            equipos: 'lectura',
            cotizaciones: 'total',
            ordenes: 'total',
            // Lecturas internas necesarias para cotizar / armar órdenes (no aparecen en el menú)
            proveedores: 'lectura',
            materiales: 'lectura',
            componentes: 'lectura',
            inventario: 'lectura',
        },
    },
    comprador: {
        clave: 'comprador',
        nombre: 'Comprador',
        descripcion:
            'Se encarga de las compras: crea y da seguimiento a las órdenes de compra (envío al proveedor, faltantes y recepción), mantiene el directorio de proveedores y los costos del catálogo de materiales. No cotiza ni maneja el inventario.',
        todo: false,
        panel: 'comprador',
        nav: ['ordenes', 'proveedores', 'materiales'],
        acceso: {
            ordenes: 'total',
            proveedores: 'total',
            materiales: 'total',
        },
    },
    capturista: {
        clave: 'capturista',
        nombre: 'Capturista',
        descripcion:
            'Da de alta y mantiene los catálogos: materiales, proveedores, componentes y equipos (BOM), sin cotizar. Su función es mantener la información base del sistema correcta y al día.',
        todo: false,
        panel: 'capturista',
        nav: ['equipos', 'componentes', 'materiales', 'proveedores'],
        acceso: {
            equipos: 'total',
            componentes: 'total',
            materiales: 'total',
            proveedores: 'total',
        },
    },
    almacenista: {
        clave: 'almacenista',
        nombre: 'Almacenista',
        descripcion:
            'Controla el inventario real (existencias, ubicaciones, mermas y pérdidas). Consulta las cotizaciones en modo solo lectura para emparejar lo que cada una necesita con el stock físico, manteniendo el sistema actualizado para la detección inteligente de faltantes.',
        todo: false,
        panel: 'almacenista',
        nav: ['inventario', 'cotizaciones'],
        acceso: {
            inventario: 'total',
            cotizaciones: 'lectura',
            materiales: 'lectura', // selector de "agregar material" del inventario
        },
    },
}

// ¿El rol alcanza al menos `nivel` en `modulo`?
export function puedeModulo(rol: Rol, modulo: Modulo, nivel: Nivel = 'lectura'): boolean {
    const def = ROL_DEFS[rol]
    if (!def) return false
    // "todo" = acceso total a todos los módulos; usuarios queda SOLO para admin
    if (def.todo) return modulo !== 'usuarios' || rol === 'admin'
    const asignado = def.acceso[modulo]
    if (!asignado) return false
    return NIVEL_VAL[asignado] >= NIVEL_VAL[nivel]
}

// ¿El usuario tiene el permiso transversal? admin y operador siempre lo tienen.
export function tienePermiso(usuario: { rol: Rol; permisos?: Partial<Record<Permiso, boolean>> }, permiso: Permiso): boolean {
    if (usuario.rol === 'admin' || usuario.rol === 'operador') return true
    return !!usuario.permisos?.[permiso]
}

// Resumen de accesos para el frontend (nav, nivel por módulo, permisos efectivos)
export function resolverAccesos(usuario: { rol: Rol; permisos?: Partial<Record<Permiso, boolean>> }) {
    const def = ROL_DEFS[usuario.rol]
    const acceso: Partial<Record<Modulo, Nivel>> = {}
    for (const m of MODULOS) {
        if (puedeModulo(usuario.rol, m, 'lectura')) {
            acceso[m] = def.todo ? 'total' : def.acceso[m]!
        }
    }
    return {
        rol: usuario.rol,
        nombreRol: def.nombre,
        panel: def.panel,
        nav: def.nav,
        acceso,
        permisos: {
            limpiarHistoriales: tienePermiso(usuario, 'limpiarHistoriales'),
            generarReportes: tienePermiso(usuario, 'generarReportes'),
        },
    }
}

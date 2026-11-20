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

// (El permiso "limpiarHistoriales" se retiró: Triaso no hace borrados masivos.)
export type Permiso = 'generarReportes'

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

// ===== Permisos POR USUARIO (CRUD por operación) =====
// El rol es la PLANTILLA; un usuario puede tener sus accesos PERSONALIZADOS, que la
// reemplazan módulo por módulo. Por cada módulo hay 5 casillas:
//   menu = aparece en la barra · ver = consultar (también el uso interno, p. ej. una
//   cotización lee materiales) · crear · editar · eliminar.
export const OPERACIONES = ['ver', 'crear', 'editar', 'eliminar'] as const
export type Operacion = (typeof OPERACIONES)[number]
export interface AccesoModulo {
    menu: boolean
    ver: boolean
    crear: boolean
    editar: boolean
    eliminar: boolean
}
export type MatrizAccesos = Record<Modulo, AccesoModulo>

const SIN_ACCESO: AccesoModulo = { menu: false, ver: false, crear: false, editar: false, eliminar: false }

// Nivel del paquete → operaciones (lectura=ver · escritura=ver+crear+editar · total=todo)
function opsDeNivel(n?: Nivel): Omit<AccesoModulo, 'menu'> {
    return {
        ver: !!n,
        crear: n === 'escritura' || n === 'total',
        editar: n === 'escritura' || n === 'total',
        eliminar: n === 'total',
    }
}

// Matriz que da el PAQUETE del rol (la plantilla).
export function matrizDeRol(rol: Rol): MatrizAccesos {
    const def = ROL_DEFS[rol]
    const out = {} as MatrizAccesos
    for (const m of MODULOS) {
        let nivel: Nivel | undefined
        if (def?.todo) nivel = m !== 'usuarios' || rol === 'admin' ? 'total' : undefined
        else nivel = def?.acceso[m]
        const ops = opsDeNivel(nivel)
        out[m] = { menu: !!def?.nav.includes(m) && ops.ver, ...ops }
    }
    return out
}

// Limpia una matriz que llega del front: solo módulos válidos, booleanos, y
// dependencias (cualquier operación o estar en el menú implica poder VER).
// El módulo Usuarios nunca se concede por personalización (es exclusivo del admin).
export function normalizarMatriz(entrada: unknown): MatrizAccesos {
    const src = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, Partial<AccesoModulo>>
    const out = {} as MatrizAccesos
    for (const m of MODULOS) {
        if (m === 'usuarios') {
            out[m] = { ...SIN_ACCESO }
            continue
        }
        const a = src[m] ?? {}
        const crear = !!a.crear
        const editar = !!a.editar
        const eliminar = !!a.eliminar
        const menu = !!a.menu
        const ver = !!a.ver || crear || editar || eliminar || menu
        out[m] = { menu, ver, crear, editar, eliminar }
    }
    return out
}

// Accesos de un documento Mongoose (Map) o de un objeto plano → objeto plano
function aPlano(accesos: unknown): Record<string, Partial<AccesoModulo>> {
    if (!accesos) return {}
    if (accesos instanceof Map) return Object.fromEntries(accesos) as Record<string, Partial<AccesoModulo>>
    return accesos as Record<string, Partial<AccesoModulo>>
}

interface UsuarioAccesos {
    rol: Rol
    accesosPersonalizados?: boolean
    accesos?: unknown
    permisos?: Partial<Record<Permiso, boolean>>
}

// Matriz EFECTIVA: la personalizada si existe; si no, la del rol.
// El admin siempre tiene todo (no se personaliza: no puede quedarse sin acceso).
export function matrizEfectiva(u: UsuarioAccesos): MatrizAccesos {
    if (u.rol === 'admin' || !u.accesosPersonalizados) return matrizDeRol(u.rol)
    const guardada = aPlano(u.accesos)
    const out = normalizarMatriz(guardada)
    // El módulo Usuarios sigue la regla del rol (solo admin)
    out.usuarios = matrizDeRol(u.rol).usuarios
    return out
}

export function puedeOperacion(u: UsuarioAccesos, modulo: Modulo, op: Operacion): boolean {
    return !!matrizEfectiva(u)[modulo]?.[op]
}

// Resumen de accesos para el frontend (nav, nivel por módulo, operaciones, permisos)
export function resolverAccesos(usuario: UsuarioAccesos) {
    const def = ROL_DEFS[usuario.rol]
    const matriz = matrizEfectiva(usuario)
    const acceso: Partial<Record<Modulo, Nivel>> = {}
    for (const m of MODULOS) {
        const a = matriz[m]
        if (!a.ver) continue
        // Nivel "compatible" para pantallas que aún preguntan por nivel
        acceso[m] = a.eliminar && a.crear && a.editar ? 'total' : a.crear || a.editar ? 'escritura' : 'lectura'
    }
    return {
        rol: usuario.rol,
        nombreRol: def.nombre,
        panel: def.panel,
        nav: MODULOS.filter((m) => matriz[m].menu),
        acceso,
        operaciones: matriz,
        personalizado: usuario.rol !== 'admin' && !!usuario.accesosPersonalizados,
        permisos: {
            generarReportes: tienePermiso(usuario, 'generarReportes'),
        },
    }
}

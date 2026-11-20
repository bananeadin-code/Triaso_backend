// Verifica que el sistema nunca se quede sin un administrador activo y que las sesiones
// se cierren al desactivar, eliminar o cambiar contraseña.
// Requiere el servidor corriendo y admin@triaso.com / admin123 (crearAdmin.ts).
// Uso: npx ts-node src/scripts/verificarGuardasAdmin.ts
export {}
const BASE = 'http://localhost:4000/api'
let fallos = 0
const check = (txt: string, c: boolean) => {
    if (!c) fallos++
    console.log(`${c ? 'OK      ' : '❌ FALLO'}  ${txt}`)
}

type H = Record<string, string>
const hdr = (token: string): H => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })
async function req(H: H | null, method: string, path: string, body?: unknown) {
    const r = await fetch(`${BASE}${path}`, {
        method,
        headers: H ?? { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    })
    let data: any = null
    try { data = await r.json() } catch { /* sin cuerpo */ }
    return { status: r.status, data }
}
async function login(email: string, password: string) {
    const r = await req(null, 'POST', '/auth/login', { email, password })
    return { status: r.status, error: r.data?.error, H: r.status === 200 ? hdr(r.data.token) : null }
}
const activosAdmin = (lista: any[]) => lista.filter((u) => u.rol === 'admin' && u.activo).length

async function main() {
    const A = (await login('admin@triaso.com', 'admin123')).H!
    const yo = (await req(A, 'GET', '/auth/perfil')).data
    const creados: string[] = []
    const crear = async (email: string, rol: string) => {
        const r = await req(A, 'POST', '/usuarios', { nombre: email, email, password: 'clave123', rol, debeCambiarPassword: false })
        creados.push(r.data.id)
        return r.data.id as string
    }

    console.log('=== Login ===')
    check('Correo en mayúsculas inicia sesión', (await login('ADMIN@Triaso.com', 'admin123')).status === 200)
    const noExiste = await login('nadie@triaso.com', 'x')
    const malaClave = await login('admin@triaso.com', 'mala')
    check('Correo inexistente y clave errónea dan el mismo 401 (no revela cuentas)',
        noExiste.status === 401 && malaClave.status === 401 && noExiste.error === malaClave.error)

    console.log('\n=== Auto-gestión del admin ===')
    check('No puede cambiarse su rol', (await req(A, 'PUT', `/usuarios/${yo._id}`, { rol: 'capturista' })).status === 409)
    check('No puede desactivarse', (await req(A, 'PUT', `/usuarios/${yo._id}`, { activo: false })).status === 409)
    check('No puede eliminarse', (await req(A, 'DELETE', `/usuarios/${yo._id}`)).status === 409)

    console.log('\n=== Validación de entrada ===')
    check('ID inválido -> 400 (antes 500)', (await req(A, 'PUT', '/usuarios/abc', { activo: true })).status === 400)
    check('Rol inexistente -> 400', (await req(A, 'PUT', `/usuarios/${yo._id}`, { rol: 'superadmin' })).status === 400)
    const cap = await crear('t_cap@triaso.com', 'capturista')
    check('activo:"false" (texto) -> 400', (await req(A, 'PUT', `/usuarios/${cap}`, { activo: 'false' })).status === 400)

    console.log('\n=== Desactivar cierra sesión ===')
    const capH = (await login('t_cap@triaso.com', 'clave123')).H!
    check('Capturista con sesión abierta accede', (await req(capH, 'GET', '/auth/perfil')).status === 200)
    await req(A, 'PUT', `/usuarios/${cap}`, { activo: false })
    const trasDesactivar = await req(capH, 'GET', '/auth/perfil')
    check('Tras desactivar, su token ya no sirve (403 "Usuario desactivado" -> el front cierra sesión)',
        trasDesactivar.status === 403 && trasDesactivar.data?.error === 'Usuario desactivado')
    check('Y no puede volver a entrar (403 desactivado)', (await login('t_cap@triaso.com', 'clave123')).status === 403)

    console.log('\n=== Eliminar cierra sesión ===')
    const tmp = await crear('t_tmp@triaso.com', 'cotizador')
    const tmpH = (await login('t_tmp@triaso.com', 'clave123')).H!
    await req(A, 'DELETE', `/usuarios/${tmp}`)
    check('Token de usuario eliminado -> 401', (await req(tmpH, 'GET', '/auth/perfil')).status === 401)

    console.log('\n=== Cambio de rol en caliente ===')
    const ad2 = await crear('t_admin2@triaso.com', 'admin')
    const B = (await login('t_admin2@triaso.com', 'clave123')).H!
    check('Admin2 entra a Usuarios', (await req(B, 'GET', '/usuarios')).status === 200)
    await req(A, 'PUT', `/usuarios/${ad2}`, { rol: 'operador' })
    check('Degradado a operador: pierde Usuarios al instante (403)', (await req(B, 'GET', '/usuarios')).status === 403)
    await req(A, 'PUT', `/usuarios/${ad2}`, { rol: 'admin' })

    console.log('\n=== Admins inactivos no cuentan como "control" ===')
    await req(A, 'PUT', `/usuarios/${ad2}`, { activo: false })
    // Ahora: A activo + admin2 inactivo. Reactivamos admin2 y que intente dejar fuera a A
    await req(A, 'PUT', `/usuarios/${ad2}`, { activo: true })
    const B2 = (await login('t_admin2@triaso.com', 'clave123')).H!
    await req(B2, 'PUT', `/usuarios/${yo._id}`, { activo: false }) // permitido: queda admin2 activo
    const r1 = await req(B2, 'PUT', `/usuarios/${ad2}`, { activo: false })
    check('Último admin activo no puede desactivarse aunque exista otro admin INACTIVO', r1.status === 409)
    const r2 = await req(B2, 'PUT', `/usuarios/${yo._id}`, { rol: 'operador' })
    check('Degradar a un admin inactivo sí se permite (no quita control)', r2.status === 200)
    await req(B2, 'PUT', `/usuarios/${yo._id}`, { rol: 'admin', activo: true })
    const A2 = (await login('admin@triaso.com', 'admin123')).H!
    check('El admin original recupera acceso', (await req(A2, 'GET', '/usuarios')).status === 200)

    console.log('\n=== Concurrencia: dos admins se quitan el control a la vez ===')
    for (const [nombre, accionA, accionB] of [
        ['degradarse mutuamente', { rol: 'operador' }, { rol: 'operador' }],
        ['desactivarse mutuamente', { activo: false }, { activo: false }],
    ] as const) {
        const ra = (await login('admin@triaso.com', 'admin123')).H!
        const rb = (await login('t_admin2@triaso.com', 'clave123')).H!
        await Promise.all([
            req(ra, 'PUT', `/usuarios/${ad2}`, accionA),
            req(rb, 'PUT', `/usuarios/${yo._id}`, accionB),
        ])
        // Comprobamos con quien haya quedado como admin
        const ok1 = await login('admin@triaso.com', 'admin123')
        const ok2 = await login('t_admin2@triaso.com', 'clave123')
        let lista: any[] = []
        for (const s of [ok1, ok2]) {
            if (!s.H) continue
            const r = await req(s.H, 'GET', '/usuarios')
            if (r.status === 200) { lista = r.data.usuarios; break }
        }
        check(`${nombre}: sigue habiendo ≥1 admin activo`, activosAdmin(lista) >= 1)
        // Restablecer ambos como admin activo para la siguiente prueba
        const admin = [ok1, ok2].find((s) => s.H)!.H!
        const quien = lista.find((u) => u.rol === 'admin' && u.activo)
        const otro = quien?._id === yo._id ? ad2 : yo._id
        await req(admin, 'PUT', `/usuarios/${otro}`, { rol: 'admin', activo: true })
    }
    console.log('\n=== Cambio de contraseña cierra otras sesiones ===')
    const P1 = (await login('admin@triaso.com', 'admin123')).H!
    const P2 = (await login('admin@triaso.com', 'admin123')).H!
    const cp = await req(P1, 'PUT', '/auth/perfil/password', { actual: 'admin123', nueva: 'admin456' })
    check('Responde con token nuevo', cp.status === 200 && !!cp.data.token)
    check('Sesión en otro equipo queda cerrada (401)', (await req(P2, 'GET', '/auth/perfil')).status === 401)
    const P3 = hdr(cp.data.token)
    check('El token nuevo sigue funcionando', (await req(P3, 'GET', '/auth/perfil')).status === 200)
    await req(P3, 'PUT', '/auth/perfil/password', { actual: 'admin456', nueva: 'admin123' })

    console.log('\n=== Restablecer contraseña y cambio obligatorio ===')
    {
        const Ad = (await login('admin@triaso.com', 'admin123')).H!
        const alta = await req(Ad, 'POST', '/usuarios', { nombre: 'Temporal', email: 't_temp@triaso.com', password: 'inicial1', rol: 'cotizador' })
        creados.push(alta.data.id)
        const T = (await login('t_temp@triaso.com', 'inicial1')).H!
        const bloq = await req(T, 'GET', '/equipos')
        check('Alta normal: con contraseña inicial no puede operar (403 CAMBIAR_PASSWORD)', bloq.status === 403 && bloq.data?.codigo === 'CAMBIAR_PASSWORD')
        const perf = await req(T, 'GET', '/auth/perfil')
        check('Pero sí ve su perfil y el aviso', perf.status === 200 && perf.data.debeCambiarPassword === true)
        check('No acepta repetir la misma contraseña', (await req(T, 'PUT', '/auth/perfil/password', { actual: 'inicial1', nueva: 'inicial1' })).status === 400)
        const cambio = await req(T, 'PUT', '/auth/perfil/password', { actual: 'inicial1', nueva: 'propia123' })
        const T2 = hdr(cambio.data.token)
        check('Tras cambiarla ya opera normal', (await req(T2, 'GET', '/equipos')).status === 200)

        check('Admin no puede restablecer su propia contraseña por aquí', (await req(Ad, 'PUT', `/usuarios/${yo._id}/password`, { password: 'xxxxxx' })).status === 409)
        check('Contraseña corta -> 400', (await req(Ad, 'PUT', `/usuarios/${alta.data.id}/password`, { password: '123' })).status === 400)
        const rp = await req(Ad, 'PUT', `/usuarios/${alta.data.id}/password`, { password: 'temporal9' })
        check('Admin restablece contraseña de otro', rp.status === 200)
        check('Su sesión anterior queda cerrada (401)', (await req(T2, 'GET', '/auth/perfil')).status === 401)
        check('La contraseña vieja ya no entra', (await login('t_temp@triaso.com', 'propia123')).status === 401)
        const T3 = (await login('t_temp@triaso.com', 'temporal9')).H!
        check('Con la temporal entra pero debe cambiarla', (await req(T3, 'GET', '/equipos')).data?.codigo === 'CAMBIAR_PASSWORD')
        check('Un no-admin no puede restablecer contraseñas', (await req(T3, 'PUT', `/usuarios/${yo._id}/password`, { password: 'hackeo1' })).status === 403)

        console.log('\n=== Bitácora de usuarios ===')
        await req(Ad, 'PUT', `/usuarios/${alta.data.id}`, { rol: 'comprador', permisos: { generarReportes: true } })
        const bit = (await req(Ad, 'GET', '/usuarios/bitacora')).data as any[]
        const deT = bit.filter((b) => b.afectado.includes('t_temp@triaso.com'))
        check('Registra alta', deT.some((b) => b.accion === 'alta'))
        check('Registra restablecimiento de contraseña', deT.some((b) => b.accion === 'password'))
        const cambioRol = deT.find((b) => b.accion === 'cambio')
        check('Registra cambio de rol y permisos con antes → ahora',
            !!cambioRol && cambioRol.detalle.some((d: string) => d.includes('Cotizador → Comprador')) && cambioRol.detalle.some((d: string) => d.includes('Generar reportes PDF: no → sí')))
        check('Registra quién lo hizo', !!cambioRol && cambioRol.actor.includes('admin@triaso.com'))
        check('Un no-admin no ve la bitácora', (await req(T3, 'GET', '/usuarios/bitacora')).status === 403)
    }

    console.log('\n=== Límite de intentos de login ===')
    {
        const estados: number[] = []
        for (let i = 0; i < 6; i++) estados.push((await login('t_fuerza@triaso.com', 'mala' + i)).status)
        check('5 fallos dan 401 y el 6.º se bloquea (429)', estados.slice(0, 5).every((s) => s === 401) && estados[5] === 429)
        check('El bloqueo es por correo: otra cuenta sigue entrando', (await login('admin@triaso.com', 'admin123')).status === 200)
    }

    console.log('\n=== Concurrencia: dos admins se eliminan a la vez ===')
    {
        const ra = (await login('admin@triaso.com', 'admin123')).H!
        const rb = (await login('t_admin2@triaso.com', 'clave123')).H!
        await Promise.all([req(ra, 'DELETE', `/usuarios/${ad2}`), req(rb, 'DELETE', `/usuarios/${yo._id}`)])
        const ok1 = await login('admin@triaso.com', 'admin123')
        const ok2 = await login('t_admin2@triaso.com', 'clave123')
        check('eliminarse mutuamente: al menos uno sigue entrando', ok1.status === 200 || ok2.status === 200)
    }

    // Limpieza (con el admin que haya sobrevivido; si se borró el original, se recrea)
    const sobrevive = (await login('admin@triaso.com', 'admin123')).H ?? (await login('t_admin2@triaso.com', 'clave123')).H!
    let { usuarios } = (await req(sobrevive, 'GET', '/usuarios')).data
    if (!usuarios.some((u: any) => u.email === 'admin@triaso.com')) {
        await req(sobrevive, 'POST', '/usuarios', { nombre: 'Administrador', email: 'admin@triaso.com', password: 'admin123', rol: 'admin', debeCambiarPassword: false })
    }
    const L = (await login('admin@triaso.com', 'admin123')).H!
    usuarios = (await req(L, 'GET', '/usuarios')).data.usuarios
    for (const u of usuarios) if (String(u.email).startsWith('t_')) await req(L, 'DELETE', `/usuarios/${u._id}`)

    console.log(fallos ? `\n❌ ${fallos} verificación(es) fallaron` : '\nTodas las verificaciones pasaron')
    process.exit(fallos ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })

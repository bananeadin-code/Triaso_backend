// Límite de intentos FALLIDOS de inicio de sesión (contra adivinar contraseñas).
// Se cuenta en tres llaves, porque en la planta todos los equipos salen a internet por la
// MISMA IP pública: limitar solo por IP bloquearía a toda la oficina por el error de uno.
//  - correo + IP : 5 fallos en 15 min  → esa combinación espera 15 min
//  - IP          : 30 fallos en 15 min → frena a quien prueba muchos correos desde un equipo
//  - correo      : 20 fallos en 15 min → frena un ataque a una cuenta desde varias IPs
// En memoria: suficiente para un solo servidor; se reinicia al reiniciar el proceso.
const VENTANA_MS = 15 * 60 * 1000
const LIMITES = { cuentaIp: 5, ip: 30, cuenta: 20 }

type Registro = { fallos: number; desde: number }
const registros = new Map<string, Registro>()

const llaves = (email: string, ip: string) => {
    const e = email.toLowerCase().trim()
    return [
        { llave: `ci:${e}|${ip}`, max: LIMITES.cuentaIp },
        { llave: `ip:${ip}`, max: LIMITES.ip },
        { llave: `c:${e}`, max: LIMITES.cuenta },
    ]
}

const vigente = (r: Registro | undefined, ahora: number) => (r && ahora - r.desde < VENTANA_MS ? r : undefined)

// ¿Está bloqueado? Devuelve los segundos que faltan (0 = puede intentar)
export function segundosDeBloqueo(email: string, ip: string): number {
    const ahora = Date.now()
    let espera = 0
    for (const { llave, max } of llaves(email, ip)) {
        const r = vigente(registros.get(llave), ahora)
        if (r && r.fallos >= max) espera = Math.max(espera, Math.ceil((r.desde + VENTANA_MS - ahora) / 1000))
    }
    return espera
}

export function registrarFallo(email: string, ip: string) {
    const ahora = Date.now()
    for (const { llave } of llaves(email, ip)) {
        const r = vigente(registros.get(llave), ahora)
        registros.set(llave, r ? { fallos: r.fallos + 1, desde: r.desde } : { fallos: 1, desde: ahora })
    }
}

// Login correcto: se olvidan los fallos de esa cuenta en esa IP (los de la IP y la cuenta
// en general se quedan, para no "lavar" un ataque con una cuenta propia válida)
export function limpiarFallos(email: string, ip: string) {
    registros.delete(llaves(email, ip)[0].llave)
}

// Limpieza periódica de registros vencidos (no retiene el proceso abierto)
setInterval(() => {
    const ahora = Date.now()
    for (const [k, r] of registros) if (ahora - r.desde >= VENTANA_MS) registros.delete(k)
}, VENTANA_MS).unref()

// Límite de intentos fallidos de login (en memoria, por IP + correo).
// 5 fallos en 15 minutos bloquean ese correo desde esa IP durante 15 minutos.
// Al reiniciar el servidor se limpia; suficiente para un sistema interno con un solo proceso.
const MAX_FALLOS = 5
const VENTANA_MS = 15 * 60 * 1000

const fallos = new Map<string, { n: number; desde: number }>()

const clave = (ip: string | undefined, email: unknown) => `${ip ?? ''}|${String(email ?? '').toLowerCase().trim()}`

// Minutos que faltan si está bloqueado; 0 si puede intentar
export function minutosBloqueo(ip: string | undefined, email: unknown): number {
    const k = clave(ip, email)
    const r = fallos.get(k)
    if (!r) return 0
    const transcurrido = Date.now() - r.desde
    if (transcurrido > VENTANA_MS) {
        fallos.delete(k)
        return 0
    }
    return r.n >= MAX_FALLOS ? Math.ceil((VENTANA_MS - transcurrido) / 60000) : 0
}

export function registrarFallo(ip: string | undefined, email: unknown) {
    const k = clave(ip, email)
    const r = fallos.get(k)
    if (!r || Date.now() - r.desde > VENTANA_MS) fallos.set(k, { n: 1, desde: Date.now() })
    else r.n++
    // Poda ocasional para que el mapa no crezca sin límite
    if (fallos.size > 5000) for (const [key, v] of fallos) if (Date.now() - v.desde > VENTANA_MS) fallos.delete(key)
}

export function limpiarFallos(ip: string | undefined, email: unknown) {
    fallos.delete(clave(ip, email))
}

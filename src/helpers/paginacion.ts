import type { Request } from 'express'

// Paginación opcional de listados: si la petición trae ?pagina=N se pagina; si no, el
// endpoint conserva su respuesta de siempre (lista completa) para quien la necesite.
export function leerPaginacion(req: Request): { pagina: number; limite: number; saltar: number } | null {
    if (req.query.pagina === undefined) return null
    const pagina = Math.max(1, Math.floor(Number(req.query.pagina)) || 1)
    const limite = Math.min(100, Math.max(5, Math.floor(Number(req.query.limite)) || 25))
    return { pagina, limite, saltar: (pagina - 1) * limite }
}

export function respuestaPaginada<T>(items: T[], total: number, p: { pagina: number; limite: number }) {
    return { items, total, pagina: p.pagina, limite: p.limite, paginas: Math.max(1, Math.ceil(total / p.limite)) }
}

// Texto de búsqueda como expresión literal (escapa . * + ? ( ) [ ] etc.): evita que un
// texto raro rompa la consulta o la vuelva lentísima (ReDoS).
export function regexBusqueda(q: unknown): RegExp | null {
    const t = String(q ?? '').trim().slice(0, 100)
    if (!t) return null
    return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

// Trae el tipo de cambio FIX (peso-dólar) del API oficial de Banxico (SIE).
// Serie SF43718 = tipo de cambio FIX (para solventar obligaciones, publicado en el DOF).
// Requiere un token gratuito que Triaso genera en el portal de Banxico (header Bmx-Token).
const SERIE_FIX = 'SF43718'
const URL = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${SERIE_FIX}/datos/oportuno`

export async function fetchTipoCambioBanxico(token: string): Promise<{ valor: number; fecha: string }> {
    if (!token) throw new Error('Falta el token de Banxico (configúralo en Configuración)')
    const r = await fetch(URL, { headers: { 'Bmx-Token': token, Accept: 'application/json' } })
    if (!r.ok) {
        if (r.status === 401 || r.status === 403) throw new Error('Token de Banxico no válido o sin permisos')
        throw new Error(`Banxico respondió ${r.status}`)
    }
    const data = (await r.json()) as { bmx?: { series?: { datos?: { fecha: string; dato: string }[] }[] } }
    const d = data?.bmx?.series?.[0]?.datos?.[0]
    const valor = Number(String(d?.dato ?? '').replace(/,/g, ''))
    if (!d || !valor || isNaN(valor)) throw new Error('Banxico no devolvió un valor válido')
    return { valor, fecha: d.fecha }
}

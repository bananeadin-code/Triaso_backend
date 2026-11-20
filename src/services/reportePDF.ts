import PDFDocument from 'pdfkit'
import fs from 'fs'
import { LEMA, LOGO_PATH, MARCA } from '../config/marca'

// ===== Paleta y utilidades =====
const NAVY = '#0b2350'
const AZUL = '#1f4bdb'
const GRIS = '#64748b'
const TXT = '#334155'
const BORDE = '#e2e8f0'
const ZEBRA = '#f8fafc'

const X0 = 40
const ANCHO = 515 // A4 (595) - 2*40
// Ancho del logo en el encabezado (pt). Al ser un wordmark horizontal se
// dimensiona por ANCHO; la altura sale sola por proporción.
const ANCHO_LOGO = 200

// Datos de la empresa para el encabezado (los fija ReporteController desde Configuración
// antes de generar cada reporte). Se lee de forma síncrona dentro de encabezado().
export interface EmpresaPDF {
    razonSocial?: string
    rfc?: string
    direccion?: string
    telefono?: string
}
let empresaActual: EmpresaPDF = {}
export function configurarEmpresa(e?: EmpresaPDF) {
    empresaActual = e ?? {}
}

export const money = (n: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0)
export const usd = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
// "—" cuando el material no se compra en esa moneda (costo 0 = vacío)
const moneyOr = (n: number) => ((n || 0) > 0 ? money(n) : '—')
const usdOr = (n: number) => ((n || 0) > 0 ? usd(n) : '—')

type Doc = PDFKit.PDFDocument
export interface Columna {
    titulo: string
    key: string
    w: number // fracción de ANCHO (deben sumar ~1)
    align?: 'left' | 'right' | 'center'
}

function nuevoDoc() {
    // bufferPages: mantiene las páginas en memoria para poder volver a cada una
    // al final y numerarlas bien ("Página X de N").
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    return { doc, chunks }
}

function finalizar(doc: Doc, chunks: Buffer[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)
        doc.end()
    })
}

function encabezado(doc: Doc, titulo: string, subtitulo?: string) {
    // Logo de la empresa a lo ancho (es un wordmark horizontal, NO cabe en una caja
    // cuadrada). Si el logo existe no se escribe además el nombre: el logo ya lo dice.
    let hayLogo = false
    if (fs.existsSync(LOGO_PATH)) {
        try {
            doc.image(LOGO_PATH, X0, 32, { width: ANCHO_LOGO })
            hayLogo = true
        } catch {
            // Archivo presente pero ilegible por pdfkit (formato no soportado): se ignora
        }
    }

    if (!hayLogo) {
        doc.fillColor(NAVY).fontSize(20).font('Helvetica-Bold').text(MARCA, X0, 40)
    }
    let yIzq = hayLogo ? 58 : 63
    doc.fillColor(GRIS).fontSize(8).font('Helvetica').text(LEMA, X0, yIzq, { width: 330, lineBreak: false })
    yIzq += 11

    // Datos de la empresa (si están configurados): razón social, RFC/Tel, dirección
    const e = empresaActual
    const l2 = [e.rfc && `RFC: ${e.rfc}`, e.telefono && `Tel: ${e.telefono}`].filter(Boolean).join('   ·   ')
    const lineas: { txt: string; bold?: boolean }[] = []
    if (e.razonSocial) lineas.push({ txt: e.razonSocial, bold: true })
    if (l2) lineas.push({ txt: l2 })
    if (e.direccion) lineas.push({ txt: e.direccion })
    doc.fontSize(7)
    for (const ln of lineas) {
        doc.fillColor(ln.bold ? NAVY : GRIS)
            .font(ln.bold ? 'Helvetica-Bold' : 'Helvetica')
            .text(ln.txt, X0, yIzq, { width: 340, lineBreak: false, ellipsis: true })
        yIzq += 9
    }

    doc.fillColor(AZUL).fontSize(14).font('Helvetica-Bold').text(titulo, X0, 42, { align: 'right' })
    doc.fillColor(GRIS)
        .fontSize(8)
        .font('Helvetica')
        .text(`Generado: ${new Date().toLocaleString('es-MX')}`, X0, 62, { align: 'right' })

    const divisorY = Math.max(yIzq + 2, 82)
    doc.moveTo(X0, divisorY).lineTo(X0 + ANCHO, divisorY).strokeColor(BORDE).stroke()
    let y = divisorY + 10
    if (subtitulo) {
        doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text(subtitulo, X0, y)
        y += 20
    }
    doc.y = y
}

function pie(doc: Doc) {
    const range = doc.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i)

        // El pie va DENTRO del margen inferior. Si se escribe ahí con el margen activo,
        // pdfkit lo considera desbordamiento y añade una página en blanco de más:
        // por eso se anula el margen mientras se dibuja y luego se restaura.
        const margenInferior = doc.page.margins.bottom
        doc.page.margins.bottom = 0

        doc.fillColor('#94a3b8')
            .fontSize(7)
            .font('Helvetica')
            .text(`Sistema Triaso · Página ${i + 1} de ${range.count}`, X0, doc.page.height - 30, {
                width: ANCHO,
                align: 'center',
            })

        doc.page.margins.bottom = margenInferior
    }
}

// Dibuja una tabla con cabecera navy, filas alternadas y saltos de página.
// La ALTURA de cada fila es dinámica: se mide el texto de cada celda (con ajuste de
// línea) y la fila crece para acomodar la celda más alta, así el texto largo (correos,
// razón social) se envuelve DENTRO de su columna sin encimar la fila de abajo.
function tabla(doc: Doc, columnas: Columna[], filas: Record<string, unknown>[], opts: { rowH?: number } = {}) {
    const minRowH = opts.rowH ?? 18
    const PAD_Y = 5 // relleno vertical arriba/abajo del texto
    const headerH = 20
    const widths = columnas.map((c) => c.w * ANCHO)
    const xs: number[] = []
    let acc = X0
    for (const w of widths) {
        xs.push(acc)
        acc += w
    }

    const dibujarCabecera = () => {
        const y = doc.y
        doc.fillColor(NAVY).rect(X0, y, ANCHO, headerH).fill()
        doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
        columnas.forEach((c, i) =>
            doc.text(c.titulo, xs[i] + 4, y + 6, {
                width: widths[i] - 8,
                align: c.align ?? 'left',
                lineBreak: false,
                ellipsis: true,
            })
        )
        doc.y = y + headerH
    }

    // Alto que ocupará el texto de una fila (la celda más alta), con el font de cuerpo.
    const altoFila = (f: Record<string, unknown>) => {
        doc.font('Helvetica').fontSize(8)
        let maxH = minRowH - 2 * PAD_Y
        columnas.forEach((c, i) => {
            const h = doc.heightOfString(String(f[c.key] ?? ''), {
                width: widths[i] - 8,
                align: c.align ?? 'left',
            })
            if (h > maxH) maxH = h
        })
        return maxH + 2 * PAD_Y
    }

    dibujarCabecera()

    filas.forEach((f, idx) => {
        const rowH = altoFila(f)
        if (doc.y + rowH > doc.page.height - 45) {
            doc.addPage()
            doc.y = 45
            dibujarCabecera()
        }
        const y = doc.y
        if (idx % 2 === 1) doc.fillColor(ZEBRA).rect(X0, y, ANCHO, rowH).fill()
        doc.fillColor(TXT).font('Helvetica').fontSize(8)
        columnas.forEach((c, i) =>
            doc.text(String(f[c.key] ?? ''), xs[i] + 4, y + PAD_Y, {
                width: widths[i] - 8,
                align: c.align ?? 'left',
            })
        )
        doc.y = y + rowH
    })
    doc.moveTo(X0, doc.y).lineTo(X0 + ANCHO, doc.y).strokeColor(BORDE).stroke()
    doc.y += 8
}

function totalDestacado(doc: Doc, etiqueta: string, valor: string, valor2?: string) {
    const y = doc.y + 4
    const h = 26
    doc.fillColor(NAVY).rect(X0, y, ANCHO, h).fill()
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text(etiqueta, X0 + 10, y + 8)
    doc.text(valor2 ? `${valor}   ·   ${valor2}` : valor, X0, y + 8, { width: ANCHO - 10, align: 'right' })
    doc.y = y + h + 8
}

// ===== Reportes =====

export function reporteInventario(items: { clave: string; concepto: string; categoria: string; stock: number; ubicacion: string }[]) {
    const { doc, chunks } = nuevoDoc()
    encabezado(doc, 'Reporte de Inventario', `${items.length} material(es) en almacén`)
    tabla(
        doc,
        [
            { titulo: 'Clave', key: 'clave', w: 0.13 },
            { titulo: 'Concepto', key: 'concepto', w: 0.42 },
            { titulo: 'Categoría', key: 'categoria', w: 0.12, align: 'center' },
            { titulo: 'Stock', key: 'stock', w: 0.12, align: 'right' },
            { titulo: 'Ubicación', key: 'ubicacion', w: 0.21 },
        ],
        items
    )
    pie(doc)
    return finalizar(doc, chunks)
}

export function reporteMateriales(mats: { clave: string; concepto: string; categoria: string; proveedor: string; costo: string }[]) {
    const { doc, chunks } = nuevoDoc()
    encabezado(doc, 'Catálogo de Materiales', `${mats.length} material(es) registrado(s)`)
    tabla(
        doc,
        [
            { titulo: 'Clave', key: 'clave', w: 0.13 },
            { titulo: 'Concepto', key: 'concepto', w: 0.4 },
            { titulo: 'Categoría', key: 'categoria', w: 0.14, align: 'center' },
            { titulo: 'Proveedor', key: 'proveedor', w: 0.16 },
            { titulo: 'Costo unitario', key: 'costo', w: 0.17, align: 'right' },
        ],
        mats
    )
    pie(doc)
    return finalizar(doc, chunks)
}

export function reporteProveedores(provs: { codigo: string; razonSocial: string; rfc: string; telefono: string; email: string }[]) {
    const { doc, chunks } = nuevoDoc()
    encabezado(doc, 'Reporte de Proveedores', `${provs.length} proveedor(es) registrado(s)`)
    tabla(
        doc,
        [
            { titulo: 'Código', key: 'codigo', w: 0.14 },
            { titulo: 'Razón social', key: 'razonSocial', w: 0.32 },
            { titulo: 'RFC', key: 'rfc', w: 0.16 },
            { titulo: 'Teléfono', key: 'telefono', w: 0.16 },
            { titulo: 'Correo', key: 'email', w: 0.22 },
        ],
        provs
    )
    pie(doc)
    return finalizar(doc, chunks)
}

export function reporteOrdenes(ordenes: { folio: string; proveedor: string; contexto: string; estado: string; items: number; total: string }[]) {
    const { doc, chunks } = nuevoDoc()
    encabezado(doc, 'Órdenes de Compra', `${ordenes.length} orden(es)`)
    tabla(
        doc,
        [
            { titulo: 'Folio', key: 'folio', w: 0.12 },
            { titulo: 'Proveedor', key: 'proveedor', w: 0.28 },
            { titulo: 'Contexto', key: 'contexto', w: 0.2 },
            { titulo: 'Estado', key: 'estado', w: 0.14, align: 'center' },
            { titulo: 'Mats.', key: 'items', w: 0.08, align: 'right' },
            { titulo: 'Total', key: 'total', w: 0.18, align: 'right' },
        ],
        ordenes
    )
    pie(doc)
    return finalizar(doc, chunks)
}

interface BomLineaRep {
    componente: string
    variacion: string
    cantidad: number
    materiales: {
        clave: string
        concepto: string
        proveedor: string
        tipo: string
        cantidad: number
        cantidadUnitaria?: number
        unidad: string
        costoMXN: number
        costoUSD: number
        importeMXN: number
        importeUSD: number
    }[]
}
interface ResumenRep {
    porCategoria: { id: string; nombre: string; mxn: number; usd: number }[]
    totalGeneral: { mxn: number; usd: number }
}

// Reporte del BOM de un equipo (construcción) — con resumen por categoría
export function reporteEquipoBOM(nombre: string, tipo: string, lineas: BomLineaRep[], resumen: ResumenRep) {
    const { doc, chunks } = nuevoDoc()
    encabezado(doc, 'Lista de Materiales (BOM)', `${nombre}${tipo ? ' · ' + tipo : ''}`)

    // Resumen por categoría
    doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold').text('Resumen de costos por categoría', X0, doc.y)
    doc.y += 4
    tabla(
        doc,
        [
            { titulo: 'Categoría', key: 'nombre', w: 0.5 },
            { titulo: 'Total MXN', key: 'mxn', w: 0.25, align: 'right' },
            { titulo: 'Total USD', key: 'usd', w: 0.25, align: 'right' },
        ],
        resumen.porCategoria.map((c) => ({ nombre: `${c.id} · ${c.nombre}`, mxn: money(c.mxn), usd: usd(c.usd) }))
    )
    totalDestacado(doc, 'TOTAL GENERAL', money(resumen.totalGeneral.mxn), usd(resumen.totalGeneral.usd))

    // Detalle por componente
    const cols: Columna[] = [
        { titulo: 'Clave', key: 'clave', w: 0.12 },
        { titulo: 'Concepto', key: 'concepto', w: 0.26 },
        { titulo: 'Tipo', key: 'tipo', w: 0.06, align: 'center' },
        { titulo: 'Cant.', key: 'cantidad', w: 0.12, align: 'right' },
        { titulo: 'C. MXN', key: 'costoMXN', w: 0.11, align: 'right' },
        { titulo: 'C. USD', key: 'costoUSD', w: 0.11, align: 'right' },
        { titulo: 'Imp. MXN', key: 'importeMXN', w: 0.12, align: 'right' },
        { titulo: 'Imp. USD', key: 'importeUSD', w: 0.1, align: 'right' },
    ]
    lineas.forEach((l) => {
        if (doc.y > doc.page.height - 120) {
            doc.addPage()
            doc.y = 45
        }
        doc.fillColor(NAVY)
            .fontSize(10)
            .font('Helvetica-Bold')
            .text(`${l.componente}  ·  ${l.variacion}  (× ${l.cantidad})`, X0, doc.y + 4)
        doc.y += 4
        tabla(
            doc,
            cols,
            l.materiales.map((m) => ({
                clave: m.clave,
                concepto: m.concepto,
                tipo: m.tipo,
                // Cantidad efectiva; con el desglose si la línea lleva más de una unidad
                cantidad:
                    l.cantidad > 1 && m.cantidadUnitaria !== undefined
                        ? `${m.cantidad} (${m.cantidadUnitaria}×${l.cantidad})`
                        : String(m.cantidad),
                costoMXN: moneyOr(m.costoMXN),
                costoUSD: usdOr(m.costoUSD),
                importeMXN: moneyOr(m.importeMXN),
                importeUSD: usdOr(m.importeUSD),
            }))
        )
    })
    pie(doc)
    return finalizar(doc, chunks)
}

interface CotLineaRep {
    componenteConcepto: string
    variacionNombre: string
    cantidad: number
    materiales: { clave: string; concepto: string; tipo: string; cantidad: number; costoMXN: number; importeMXN: number; costoUSD?: number; importeUSD: number; fuente?: string }[]
}

// Reporte/invoice de una cotización YA SURTIDA (sin stock, solo la cotización).
// Los costos son los REALES: por material, el costo de SU orden (si vino de una,
// incluso de un proveedor alterno) o el costo actual del catálogo si estaba en stock.
export function reporteCotizacion(
    folio: string,
    equipo: string,
    contexto: string,
    lineas: CotLineaRep[],
    costoTotal: number,
    ajustadoManual = false,
    costoTotalUSD = 0
) {
    const { doc, chunks } = nuevoDoc()
    encabezado(doc, 'Reporte de Cotización', `${folio} · ${equipo}`)
    doc.fillColor(GRIS)
        .fontSize(9)
        .font('Helvetica')
        .text(
            `Contexto: ${contexto === 'reparacion' ? 'Reparación' : 'Creación'}   ·   Costos reales de compra`,
            X0,
            doc.y
        )
    doc.y += 14

    const cols: Columna[] = [
        { titulo: 'Clave', key: 'clave', w: 0.1 },
        { titulo: 'Concepto', key: 'concepto', w: 0.24 },
        { titulo: 'Cant.', key: 'cantidad', w: 0.07, align: 'right' },
        { titulo: 'C. real MXN', key: 'costoMXN', w: 0.12, align: 'right' },
        { titulo: 'Imp. MXN', key: 'importeMXN', w: 0.12, align: 'right' },
        { titulo: 'C. real USD', key: 'costoUSD', w: 0.11, align: 'right' },
        { titulo: 'Imp. USD', key: 'importeUSD', w: 0.11, align: 'right' },
        { titulo: 'Fuente', key: 'fuente', w: 0.13 },
    ]
    lineas.forEach((l) => {
        if (doc.y > doc.page.height - 120) {
            doc.addPage()
            doc.y = 45
        }
        doc.fillColor(NAVY)
            .fontSize(10)
            .font('Helvetica-Bold')
            .text(`${l.componenteConcepto}  ·  ${l.variacionNombre}  (× ${l.cantidad})`, X0, doc.y + 4)
        doc.y += 4
        tabla(
            doc,
            cols,
            l.materiales.map((m) => ({
                clave: m.clave,
                concepto: m.concepto,
                cantidad: m.cantidad,
                costoMXN: moneyOr(m.costoMXN),
                importeMXN: moneyOr(m.importeMXN),
                costoUSD: usdOr(m.costoUSD ?? 0),
                importeUSD: usdOr(m.importeUSD),
                fuente: m.fuente ?? 'Catálogo',
            }))
        )
    })
    totalDestacado(
        doc,
        ajustadoManual ? 'COSTO REAL TOTAL (AJUSTADO)' : 'COSTO REAL TOTAL DE LA COTIZACIÓN',
        money(costoTotal),
        usd(costoTotalUSD)
    )
    pie(doc)
    return finalizar(doc, chunks)
}

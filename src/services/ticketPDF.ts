import PDFDocument from 'pdfkit'
import fs from 'fs'
import { IOrdenCompra } from '../models/OrdenCompra'
import { LOGO_PATH, MARCA } from '../config/marca'

// Genera el ticket/factura de la orden en PDF (SIN costos ni totales).
export function generarTicketPDF(orden: IOrdenCompra): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 })
        const chunks: Buffer[] = []
        doc.on('data', (c: Buffer) => chunks.push(c))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const azul = '#1f4bdb'
        const navy = '#0b2350'

        // Encabezado: el logo es un wordmark horizontal, se dimensiona por ANCHO.
        // Si está presente no se escribe además el nombre (el logo ya lo dice).
        let hayLogo = false
        if (fs.existsSync(LOGO_PATH)) {
            try {
                doc.image(LOGO_PATH, 50, 44, { width: 210 })
                hayLogo = true
            } catch {
                // Archivo presente pero ilegible por pdfkit: se ignora y va solo el nombre
            }
        }

        if (!hayLogo) {
            doc.fillColor(navy).fontSize(24).font('Helvetica-Bold').text(MARCA, 50, 50)
        }
        doc.fillColor('#64748b')
            .fontSize(9)
            .font('Helvetica')
            .text('Fabricación de equipos de manufactura y trituradoras', 50, hayLogo ? 72 : 78, { width: 300 })
        doc.text('Durango, México', 50, hayLogo ? 84 : 90)

        doc.fillColor(azul).fontSize(16).font('Helvetica-Bold').text('ORDEN DE COMPRA', 50, 50, { align: 'right' })
        doc.fillColor(navy).fontSize(12).font('Helvetica-Bold').text(orden.folio, 50, 74, { align: 'right' })
        const fecha = orden.enviadaAt ?? new Date()
        doc.fillColor('#64748b').fontSize(9).font('Helvetica').text(
            `Fecha: ${new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}`,
            50,
            92,
            { align: 'right' }
        )

        // Línea separadora
        doc.moveTo(50, 120).lineTo(545, 120).strokeColor('#e2e8f0').stroke()

        // Datos del proveedor
        const p = orden.proveedorSnap
        doc.fillColor('#64748b').fontSize(9).font('Helvetica-Bold').text('PROVEEDOR', 50, 135)
        doc.fillColor(navy).fontSize(11).font('Helvetica-Bold').text(`${p.codigo}  ·  ${p.razonSocial}`, 50, 150)
        let y = 168
        doc.fillColor('#334155').fontSize(9).font('Helvetica')
        if (p.rfc) {
            doc.text(`RFC: ${p.rfc}`, 50, y)
            y += 14
        }
        if (p.direccion) {
            doc.text(`Dirección: ${p.direccion}`, 50, y)
            y += 14
        }

        // Tabla de materiales (SIN costos)
        y += 16
        doc.fillColor(navy).rect(50, y, 495, 22).fill()
        doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
        doc.text('CONCEPTO', 60, y + 7)
        doc.text('CANTIDAD', 460, y + 7, { width: 75, align: 'right' })
        y += 22

        doc.font('Helvetica').fillColor('#334155').fontSize(10)
        orden.items.forEach((it, i) => {
            if (i % 2 === 1) {
                doc.fillColor('#f8fafc').rect(50, y, 495, 20).fill()
            }
            doc.fillColor('#334155')
            doc.text(it.concepto, 60, y + 6, { width: 380 })
            doc.text(String(it.cantidad), 460, y + 6, { width: 75, align: 'right' })
            y += 20
        })

        doc.moveTo(50, y).lineTo(545, y).strokeColor('#e2e8f0').stroke()

        // Pie
        doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text(
            'Documento generado por el sistema Triaso. Este ticket no incluye montos; los costos se acuerdan directamente con el proveedor.',
            50,
            y + 20,
            { width: 495, align: 'center' }
        )

        doc.end()
    })
}

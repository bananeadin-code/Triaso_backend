import nodemailer from 'nodemailer'

// Envía la orden de compra por correo al proveedor, con el ticket PDF adjunto.
// Lanza 'SIN_CREDENCIALES' si no hay configuración de Gmail en el entorno.
export async function enviarCorreoOrden(opts: { to: string; folio: string; pdf: Buffer }) {
    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD
    if (!user || !pass) {
        throw new Error('SIN_CREDENCIALES')
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
    })

    await transporter.sendMail({
        from: `Triaso <${user}>`,
        to: opts.to,
        subject: `Orden de compra ${opts.folio} — Triaso`,
        text: `Estimado proveedor:\n\nAdjunto encontrará la orden de compra ${opts.folio}. Quedamos atentos para confirmar disponibilidad y detalles.\n\nSaludos,\nTriaso`,
        attachments: [{ filename: `${opts.folio}.pdf`, content: opts.pdf }],
    })
}

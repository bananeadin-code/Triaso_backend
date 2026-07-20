// Verifica que los reportes NO generen una hoja en blanco de más y que la numeración
// "Página X de N" sea correcta cuando el contenido ocupa varias páginas.
// Uso: npx ts-node src/scripts/verificarPaginacionPDF.ts
import zlib from 'zlib'
import { reporteMateriales } from '../services/reportePDF'

function paginas(pdf: Buffer) {
    const m = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Pages[\s\S]{0,300}?\/Count\s+(\d+)/g)]
    return m.length ? Math.max(...m.map((x) => Number(x[1]))) : 0
}

// pdfkit escribe el texto en hex dentro de arreglos TJ
function pies(pdf: Buffer) {
    const data = pdf.toString('latin1')
    const salida: string[] = []
    const re = /stream\r?\n/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(data))) {
        const ini = mm.index + mm[0].length
        const fin = data.indexOf('endstream', ini)
        let txt: string
        try {
            txt = zlib.inflateSync(Buffer.from(data.slice(ini, fin), 'latin1')).toString('latin1')
        } catch {
            continue
        }
        for (const bloque of txt.matchAll(/\[(.*?)\]\s*TJ/gs)) {
            const cadena = [...bloque[1].matchAll(/<([0-9a-fA-F]+)>/g)]
                .map((h) => Buffer.from(h[1], 'hex').toString('latin1'))
                .join('')
            if (cadena.includes('gina')) salida.push(cadena)
        }
    }
    return salida
}

async function main() {
    for (const n of [3, 40, 120]) {
        const filas = Array.from({ length: n }, (_, i) => ({
            clave: `MA${String(i + 1).padStart(4, '0')}`,
            concepto: `Material de prueba número ${i + 1}`,
            categoria: 'B',
            proveedor: 'ACEROS',
            costo: '$1,000.00',
        }))
        const pdf = await reporteMateriales(filas)
        const p = paginas(pdf)
        const f = pies(pdf)
        const esperado = Array.from({ length: p }, (_, i) => `Página ${i + 1} de ${p}`)
        const bien = f.length === p && f.every((t, i) => t.includes(esperado[i]))
        console.log(`${String(n).padStart(3)} filas -> ${p} pág. | pies: ${JSON.stringify(f)} ${bien ? 'OK' : '❌ FALLO'}`)
    }
}

main().catch((e) => console.error(e))

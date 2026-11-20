// Prueba de punta a punta de la importación de BOM con un archivo REAL de Triaso:
// lee el Excel con el MISMO lector del front → analiza → aplica → compara contra el Excel →
// re-analiza (todo debe reconocerse como existente) → deshace → verifica que no quedó nada.
// Uso: npx ts-node src/scripts/verificarImportacionBOM.ts "C:\ruta\archivo.xls"
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import Module from 'module'
import ts from 'typescript'
import type { ArchivoBOM } from '../services/importacionBOM'

// El front es un paquete ES Module: se transpila al vuelo su lector para probar EXACTAMENTE ese código
const FRONT = path.resolve(__dirname, '../../../triaso_front')
function cargarLector(): { parsearFilasBOM: (filas: unknown[][], archivo: string) => ArchivoBOM } {
    const archivo = path.join(FRONT, 'src/lib/importarBOM.ts')
    const js = ts.transpileModule(fs.readFileSync(archivo, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    const M = Module as unknown as { new (id: string): { paths: string[]; _compile: (c: string, f: string) => void; exports: unknown }; _nodeModulePaths: (d: string) => string[] }
    const m = new M(archivo)
    m.paths = M._nodeModulePaths(path.dirname(archivo))
    m._compile(js, archivo)
    return m.exports as ReturnType<typeof cargarLector>
}
const { parsearFilasBOM } = cargarLector()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require(path.join(FRONT, 'node_modules/xlsx'))

const BASE = 'http://localhost:4000/api'
const ok = (c: boolean) => (c ? 'OK' : '❌ FALLO')

async function main() {
    const ruta = process.argv[2]
    const wb = XLSX.readFile(ruta)
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' })
    const archivo = parsearFilasBOM(filas, ruta.split(/[\\/]/).pop()!)
    const renglones = archivo.secciones.reduce((t, s) => t + s.filas.length, 0)
    console.log(`Lector: equipo "${archivo.equipo.clave}" · ${archivo.secciones.length} secciones · ${renglones} renglones · sumas: ${JSON.stringify(archivo.sumas)}`)

    const la = await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@triaso.com', password: 'admin123' }) })).json()
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${la.token}` }
    const post = async (url: string, body: unknown) => {
        const r = await fetch(`${BASE}${url}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
        return { status: r.status, data: await r.json() }
    }

    // ---- 1. Análisis ----
    const t0 = Date.now()
    const an = (await post('/importaciones/bom/analizar', { archivo })).data
    console.log(`\nAnálisis en ${Date.now() - t0} ms`)
    console.log(`  Equipo: "${an.equipo.nombre}" (${an.equipo.existente ? 'YA EXISTE' : 'nuevo'}) · descripción: ${an.equipo.descripcion.slice(0, 60)}…`)
    console.log(`  Secciones: ${an.resumen.secciones} componentes + ${an.resumen.grupos} grupos · ${an.resumen.renglones} renglones`)
    console.log(`  Proveedores: ${an.proveedores.filter((p: { existente: unknown }) => p.existente).length} existentes, ${an.proveedores.filter((p: { accion: string }) => p.accion === 'crear').length} nuevos`)
    const mats = an.materiales as { estado: string; parecidos: unknown[]; preciosArchivo: number[] }[]
    console.log(`  Materiales: ${mats.length} (${mats.filter((m) => m.estado === 'existe').length} existentes, ${mats.filter((m) => m.estado === 'nuevo').length} nuevos, ${mats.filter((m) => m.parecidos.length).length} con parecido, ${mats.filter((m) => m.preciosArchivo.length > 1).length} con varios precios)`)
    console.log(`  Conflictos de clave: ${an.conflictos.length} (ej. ${an.conflictos.slice(0, 2).map((c: { clave: string; variantes: { concepto: string }[] }) => `${c.clave}: ${c.variantes.map((v) => v.concepto).join(' / ')}`).join(' · ')})`)
    const comps = an.componentes as { nombre: string; nombreArchivo: string; accion: string }[]
    const renombrados = comps.filter((c) => c.nombre !== c.nombreArchivo)
    console.log(`  Componentes: ${comps.length} · acciones: ${JSON.stringify(comps.reduce((a: Record<string, number>, c) => ({ ...a, [c.accion]: (a[c.accion] ?? 0) + 1 }), {}))} · renombrados por repetirse: ${renombrados.slice(0, 4).map((c) => c.nombre).join(', ')}…`)
    console.log(`  Unidades: ${an.unidades.map((u: { archivo: string; catalogo: string; nueva: boolean }) => `${u.archivo}→${u.catalogo}${u.nueva ? ' (nueva)' : ''}`).join(', ')}`)
    console.log('  Verificación de totales (Excel vs importado):')
    for (const v of an.verificacion) console.log(`    ${v.categoria}: ${v.excel ?? '—'} vs ${v.importado.toFixed(2)}  ${v.excel !== null && Math.abs(v.excel - v.importado) <= Math.max(5, v.excel * 0.001) ? '✓' : '≠'}`)
    console.log(`  Bloqueos: ${an.bloqueos.length ? an.bloqueos.join(' | ') : 'ninguno'} · Avisos: ${an.avisos.length}`)
    console.log('Análisis sin bloqueos:', ok(an.bloqueos.length === 0))

    // ---- 2. Aplicar ----
    const t1 = Date.now()
    const ap = await post('/importaciones/bom/aplicar', { archivo, decisiones: {} })
    console.log(`\nAplicar → ${ap.status} en ${Date.now() - t1} ms · ${ap.data.folio ?? ap.data.error}`)
    if (ap.status !== 201) {
        console.log(ap.data)
        process.exit(1)
    }
    ap.data.resumen.forEach((r: string) => console.log('  ' + r))

    // ---- 3. Comparar el BOM resultante contra el Excel ----
    // El BOM guarda pesos y dólares por separado; el Excel los suma convirtiendo con su paridad
    const eq = await (await fetch(`${BASE}/equipos/${ap.data.equipoId}`, { headers: H })).json()
    const par = archivo.secciones.flatMap((s) => s.filas).find((f) => (f.paridad ?? 0) > 0)?.paridad ?? 0
    const excelTotal = archivo.sumas?.total ?? 0
    const consolidado = eq.resumen.totalGeneral.mxn + eq.resumen.totalGeneral.usd * par
    console.log(`BOM del equipo importado: ${eq.lineas.length} líneas · MXN ${eq.resumen.totalGeneral.mxn.toFixed(2)} + USD ${eq.resumen.totalGeneral.usd.toFixed(2)} × ${par} = ${consolidado.toFixed(2)} vs Excel ${excelTotal}:`,
        ok(Math.abs(consolidado - excelTotal) <= Math.max(10, excelTotal * 0.0005)))
    for (const cat of eq.resumen.porCategoria) {
        const ex = archivo.sumas?.[cat.id]
        const conv = cat.mxn + cat.usd * par
        if (ex !== undefined) console.log(`    ${cat.id} ${cat.nombre}: ${conv.toFixed(2)} vs ${ex}  ${Math.abs(conv - ex) <= Math.max(5, ex * 0.0005) ? '✓' : '≠'}`)
    }
    const porValidar = await (await fetch(`${BASE}/materiales`, { headers: H })).json()
    console.log('Materiales nuevos quedaron "por validar":', ok(porValidar.filter((m: { porValidar: boolean }) => m.porValidar).length >= mats.filter((m) => m.estado === 'nuevo').length))

    // ---- 4. Re-analizar el mismo archivo: todo debe reconocerse (equipo existe → hay que decidir) ----
    const an2 = (await post('/importaciones/bom/analizar', { archivo })).data
    const nuevos2 = (an2.materiales as { estado: string }[]).filter((m) => m.estado === 'nuevo').length
    const usar2 = (an2.componentes as { accion: string }[]).filter((c) => c.accion === 'usarVariacion').length
    console.log(`Re-análisis: ${nuevos2} materiales nuevos (debe 0), ${usar2}/${an2.componentes.length} componentes reconocidos con su variación idéntica, equipo existente bloquea hasta decidir:`,
        ok(nuevos2 === 0 && usar2 === an2.componentes.length && an2.bloqueos.some((b: string) => b.includes('Ya existe un equipo'))))

    // ---- 5. Deshacer ----
    const t2 = Date.now()
    const de = await post(`/importaciones/${ap.data.id}/deshacer`, {})
    console.log(`\nDeshacer → ${de.status} en ${Date.now() - t2} ms · ${de.data.mensaje ?? de.data.error}`, de.data.bloqueos ?? '')
    const an3 = (await post('/importaciones/bom/analizar', { archivo })).data
    const nuevos3 = (an3.materiales as { estado: string }[]).filter((m) => m.estado === 'nuevo').length
    console.log('Tras deshacer, el catálogo quedó como antes (mismos materiales nuevos y equipo libre):',
        ok(de.status === 200 && nuevos3 === mats.filter((m) => m.estado === 'nuevo').length && !an3.equipo.existente))
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})

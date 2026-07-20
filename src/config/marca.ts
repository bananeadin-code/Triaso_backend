import path from 'path'

// ===== Identidad visual en los reportes PDF =====
// PARA CAMBIAR EL LOGO DE LOS REPORTES: guarda el archivo en  triaso_server/assets/
// y ajusta AQUÍ el nombre. Es el único lugar que hay que tocar en el backend.
//
// OJO: el PDF se genera en el servidor, así que necesita su propia copia del archivo
// (no puede leer el /public del frontend). Formatos soportados por pdfkit: PNG y JPG.
export const LOGO_ARCHIVO = 'logo.png'
export const LOGO_PATH = path.join(process.cwd(), 'assets', LOGO_ARCHIVO)

export const MARCA = 'TRIASO'
export const LEMA = 'Fabricación de equipos de manufactura y trituradoras · Durango, México'

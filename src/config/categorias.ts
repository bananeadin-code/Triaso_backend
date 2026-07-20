// Fuente única de verdad de las 5 categorías de Triaso.
// El `id` (letra A-E) se usa en el resumen de costos del BOM.
// El `prefijo` (2 letras) se usa para generar la clave del material (ej. EL0001).

export const CATEGORIAS = [
    { id: 'A', nombre: 'Pailería', prefijo: 'PA' },
    { id: 'B', nombre: 'Maquinados', prefijo: 'MA' },
    { id: 'C', nombre: 'Componentes', prefijo: 'CO' },
    { id: 'D', nombre: 'Eléctrico y control', prefijo: 'EL' },
    { id: 'E', nombre: 'Acabado', prefijo: 'AC' },
] as const

export type CategoriaId = (typeof CATEGORIAS)[number]['id']

export const CATEGORIA_IDS = CATEGORIAS.map((c) => c.id) as CategoriaId[]

export const getCategoria = (id: string) => CATEGORIAS.find((c) => c.id === id)

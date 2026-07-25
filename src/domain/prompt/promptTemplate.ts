/**
 * Contrato del prompt editable por cada gym.
 *
 * El dueño escribe su propio texto (equipamiento, espacios, tono, restricciones) e
 * inserta placeholders `{{nombre}}` donde quiere que se inyecten los datos del
 * cliente. Este módulo define qué placeholders existen, valida un template antes de
 * guardarlo y hace el reemplazo.
 *
 * Módulo puro: sin Express, sin Mongoose, sin SDKs. El renderizado vive acá y no en
 * los adaptadores de IA para que exista UNA sola definición del contrato, y para que
 * la misma lista sirva para validar al guardar y para reemplazar al generar.
 */

export const PROMPT_PLACEHOLDERS = [
  'respuestas_encuesta',
  'cliente_nombre',
  'cliente_documento',
  'cliente_email',
  'cliente_telefono',
  'cliente_fecha_inicio',
  'cliente_fecha_vencimiento',
  'gym_nombre',
  'fecha_actual',
] as const;

export type PromptPlaceholder = (typeof PROMPT_PLACEHOLDERS)[number];

export interface PromptContext {
  encuestaData: Record<string, any>;
  clienteNombre: string;
  clienteDocumento: string;
  clienteEmail?: string;
  clienteTelefono?: string;
  clienteFechaInicio: Date;
  clienteFechaVencimiento: Date;
  gymNombre: string;
}

const VALOR_NO_INFORMADO = 'no informado';

// Tolera espacios internos: {{ cliente_nombre }} es equivalente a {{cliente_nombre}}
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const esPlaceholderConocido = (nombre: string): nombre is PromptPlaceholder =>
  (PROMPT_PLACEHOLDERS as readonly string[]).includes(nombre);

/** Devuelve los placeholders usados en el template, sin repetir. */
export const extractPlaceholders = (template: string): string[] => {
  const encontrados = [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
  return [...new Set(encontrados)];
};

/**
 * Valida un template. Devuelve el mensaje de error, o null si es válido.
 *
 * Dos reglas, ambas por la misma razón: que el fallo se vea al configurar y no
 * quede invisible al generar la rutina.
 *  1. Al menos un placeholder conocido. Sin ninguno, el modelo recibiría un prompt
 *     sin datos del cliente y devolvería una rutina genérica sin avisar.
 *  2. Ningún placeholder desconocido. Un `{{maquinaria}}` mal escrito se enviaría
 *     literal al modelo en vez de reemplazarse.
 */
export const validatePromptTemplate = (template: string): string | null => {
  const disponibles = PROMPT_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ');
  const usados = extractPlaceholders(template);

  const desconocidos = usados.filter((nombre) => !esPlaceholderConocido(nombre));
  if (desconocidos.length > 0) {
    const listado = desconocidos.map((nombre) => `{{${nombre}}}`).join(', ');
    return `Unknown placeholders in prompt template: ${listado}. Available: ${disponibles}`;
  }

  if (usados.length === 0) {
    return `The prompt template must include at least one placeholder, otherwise no client data reaches the AI model. Available: ${disponibles}`;
  }

  return null;
};

const formatearFecha = (fecha: Date): string =>
  new Date(fecha).toLocaleDateString('es-AR');

/**
 * Reemplaza TODAS las apariciones de cada placeholder (el `.replace()` con string
 * que había en los adaptadores solo sustituía la primera).
 */
export const renderPromptTemplate = (template: string, context: PromptContext): string => {
  const valores: Record<PromptPlaceholder, string> = {
    respuestas_encuesta: JSON.stringify(context.encuestaData, null, 2),
    cliente_nombre: context.clienteNombre,
    cliente_documento: context.clienteDocumento,
    cliente_email: context.clienteEmail || VALOR_NO_INFORMADO,
    cliente_telefono: context.clienteTelefono || VALOR_NO_INFORMADO,
    cliente_fecha_inicio: formatearFecha(context.clienteFechaInicio),
    cliente_fecha_vencimiento: formatearFecha(context.clienteFechaVencimiento),
    gym_nombre: context.gymNombre,
    fecha_actual: formatearFecha(new Date()),
  };

  return template.replace(PLACEHOLDER_PATTERN, (original, nombre: string) =>
    esPlaceholderConocido(nombre) ? valores[nombre] : original
  );
};

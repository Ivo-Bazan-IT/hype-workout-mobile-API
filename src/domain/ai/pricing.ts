/**
 * Precios de referencia para estimar el costo de cada rutina generada.
 *
 * Módulo puro: sin SDKs, sin Mongoose, sin env. Vive en el dominio porque "cuánto
 * cuesta atender a este gym" es una regla de negocio, no un detalle del adaptador.
 *
 * ⚠️  VALORES DE REFERENCIA, NO FUENTE DE VERDAD.
 * Los precios de los proveedores cambian y varían por región y plan. Verificalos
 * contra la pricing page de cada proveedor ANTES de usar estos números para
 * facturarle a un gym o para definir tarifas.
 *
 * Un modelo que no esté en la tabla NO rompe nada: se registran igual los tokens y
 * el costo queda en `null`, y el reporte informa cuántas rutinas quedaron sin
 * precio. Es preferible a inventar un costo de 0 que se lea como "salió gratis".
 */

export interface ModelPricing {
  /** USD por millón de tokens de entrada (prompt) */
  entrada: number;
  /** USD por millón de tokens de salida (respuesta) */
  salida: number;
}

const UN_MILLON = 1_000_000;

/**
 * Clave: nombre exacto del modelo tal como lo reporta el proveedor.
 * Arrancan cargados los tres modelos por defecto de los adaptadores.
 */
export const PRECIOS_USD_POR_MILLON: Record<string, ModelPricing> = {
  // DeepSeek — el default de la plataforma por ser el más barato por rutina
  'deepseek-chat': { entrada: 0.27, salida: 1.1 },
  // OpenAI
  'gpt-4o-mini': { entrada: 0.15, salida: 0.6 },
  'gpt-4o': { entrada: 2.5, salida: 10 },
  // Anthropic
  'claude-3-7-sonnet-20250219': { entrada: 3, salida: 15 },
  // Capa gratuita vía OpenRouter. El 0 acá es un precio REAL, no un "no sé":
  // son modelos sin costo por token, y dejarlos fuera de la tabla los contaría
  // como rutinas sin precio, que es otra cosa. Si dejan de ser gratuitos o se
  // cambia de modelo, esta entrada hay que revisarla.
  'nvidia/nemotron-3-super-120b-a12b:free': { entrada: 0, salida: 0 },
};

/** ¿Hay precio cargado para este modelo? */
export const tienePrecio = (model: string): boolean =>
  Object.prototype.hasOwnProperty.call(PRECIOS_USD_POR_MILLON, model);

/**
 * Costo estimado en USD de una generación.
 * Devuelve `null` si el modelo no tiene precio cargado.
 */
export const calcularCostoEstimado = (
  model: string,
  tokensPrompt: number,
  tokensRespuesta: number
): number | null => {
  const precio = PRECIOS_USD_POR_MILLON[model];
  if (!precio) {
    return null;
  }

  const costo =
    (tokensPrompt / UN_MILLON) * precio.entrada +
    (tokensRespuesta / UN_MILLON) * precio.salida;

  // 6 decimales: una rutina con DeepSeek cuesta fracciones de centavo y redondear
  // antes haría que todas las generaciones baratas se registren como 0.
  return Number(costo.toFixed(6));
};

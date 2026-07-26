/**
 * Prompt standard de la plataforma y contrato de formato de la rutina.
 *
 * Separa dos responsabilidades que antes estaban mezcladas y sin dueño claro:
 *
 *  - El **formato** (qué JSON devuelve el modelo) es de la PLATAFORMA, porque el
 *    renderer del PDF es el que tiene que maquetarlo. Va en la instrucción de
 *    sistema, que el gym no edita.
 *  - El **contenido** (qué ejercicios, con qué criterio, con qué tono) es del GYM.
 *    Va en su `aiConfig.promptTemplate`, y si no escribió uno se usa el standard.
 *
 * Antes, la instrucción de sistema pedía "la estructura de rutina solicitada" sin
 * que nadie la definiera: el contrato con el PDF quedaba implícito en el prompt que
 * cada gym escribiera. Si no coincidía, el socio recibía un PDF con el JSON crudo
 * impreso y nadie se enteraba hasta verlo.
 */

/** De dónde salió el prompt usado. */
export type FuentePrompt = 'gym' | 'standard';

/**
 * Instrucción de sistema: fija la forma del JSON que el modelo debe devolver.
 *
 * Es la MISMA para los tres adaptadores (antes estaba copiada en cada uno, con el
 * riesgo de que divergieran y un gym obtuviera distinta forma según el proveedor).
 * Los campos son exactamente los que lee `renderRoutineAsHtml` en el generador de
 * PDF: si se toca uno, hay que tocar el otro.
 */
export const INSTRUCCION_FORMATO_RUTINA = `Devolvé únicamente un JSON válido, sin texto adicional y sin bloques de markdown.

Usá exactamente esta estructura:
{
  "dias": [
    {
      "nombre": "Día 1 - Tren superior",
      "ejercicios": [
        {
          "nombre": "Press de banca",
          "series": "4",
          "repeticiones": "8-10",
          "descanso": "90s",
          "notas": "Indicación breve de técnica, o vacío"
        }
      ],
      "observaciones": "Nota general del día, o vacío"
    }
  ]
}

Reglas del formato:
- Todos los valores son strings, incluso los numéricos ("4", no 4).
- "notas" y "observaciones" son opcionales: pueden ir como string vacío.
- No agregues claves fuera de las listadas ni envuelvas el objeto en otra clave.`;

/**
 * Prompt de contenido por defecto, usado cuando el gimnasio no escribió el suyo.
 *
 * Solo usa placeholders de `PROMPT_PLACEHOLDERS`, así que pasa `validatePromptTemplate`.
 * No dice nada del formato JSON a propósito: de eso se ocupa la instrucción de
 * sistema, y repetirlo acá haría que un gym que edita su prompt pueda romper el
 * contrato con el PDF sin darse cuenta.
 */
export const PROMPT_STANDARD = `Sos el entrenador personal de {{gym_nombre}}.

Armá una rutina de entrenamiento personalizada para {{cliente_nombre}} a partir de las respuestas que dejó en su encuesta de ingreso:

{{respuestas_encuesta}}

Pautas para armarla:
- Respetá las lesiones, molestias y limitaciones que haya declarado. Ante la duda, elegí la variante más segura del ejercicio y aclarálo en las notas.
- Ajustá la cantidad de días a la disponibilidad semanal que indicó. Si no la indicó, armá 3 días.
- Adecuá el volumen, la carga y la complejidad a su nivel de experiencia.
- Usá ejercicios de gimnasio convencional. Si alguno necesita una máquina puntual, ofrecé una alternativa con peso libre en las notas.
- Escribí en español rioplatense, de vos, con indicaciones concretas y breves.

El plan está vigente hasta el {{cliente_fecha_vencimiento}}.`;

/**
 * Prompt que se le asignaba automáticamente a cada gym nuevo antes de que existiera
 * el standard: el JSON de la encuesta y nada más, sin una sola instrucción.
 *
 * Se trata como "sin configurar" y no como una elección del dueño, porque nunca lo
 * escribió nadie: lo ponía el alta. Dejarlo pasar significaría que todos los gyms
 * creados hasta ahora sigan mandándole al modelo un volcado de datos sin consigna.
 */
export const PROMPT_LEGACY_POR_DEFECTO = '{{respuestas_encuesta}}';

/**
 * Elige el prompt de contenido: el del gym si escribió uno, el standard si no.
 *
 * No lanza si está vacío: quedarse sin generar la rutina por una configuración que
 * el dueño nunca tocó sería peor que generarla con un prompt razonable.
 */
export const resolverPromptTemplate = (
  delGym: string | undefined
): { template: string; fuente: FuentePrompt } => {
  const propio = delGym?.trim();

  if (propio && propio !== PROMPT_LEGACY_POR_DEFECTO) {
    return { template: propio, fuente: 'gym' };
  }

  return { template: PROMPT_STANDARD, fuente: 'standard' };
};

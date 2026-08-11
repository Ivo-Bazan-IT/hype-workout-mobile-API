/**
 * Resolución de los campos del cliente a partir de las respuestas crudas del
 * formulario de ingreso.
 *
 * Cada gimnasio arma su propio Google Form y titula las preguntas como quiere, así
 * que hay dos caminos:
 *
 *  1. **Mapeo explícito** (`fieldMapping`): el gym declara qué pregunta corresponde a
 *     cada campo. Es el modo confiable y el que hay que usar en producción.
 *  2. **Heurística por alias**: para los gyms que todavía no configuraron el mapeo.
 *     Adivina, y adivinar puede equivocarse — por eso puntúa las coincidencias en vez
 *     de quedarse con la primera que encuentra.
 */

export const CAMPOS_DEL_CLIENTE = ['nombre', 'documento', 'telefono', 'email'] as const;

export type CampoDelCliente = (typeof CAMPOS_DEL_CLIENTE)[number];

/**
 * Campos de la encuesta que el prompt de generación puede inyectar uno por uno.
 *
 * Son distintos de `CAMPOS_DEL_CLIENTE`: aquellos son columnas de `Client` y estos
 * viven dentro de `encuestaData`. Existen para que el gym pueda escribir
 * "entrena {{cliente_dias_por_semana}} veces por semana" en vez de volcarle al
 * modelo el JSON crudo y confiar en que lo interprete.
 */
export const CAMPOS_DE_ENCUESTA = [
  'edad',
  'objetivo',
  'lesiones',
  'diasPorSemana',
] as const;

export type CampoDeEncuesta = (typeof CAMPOS_DE_ENCUESTA)[number];

/**
 * Título EXACTO de la pregunta del formulario que alimenta cada campo.
 * Todos opcionales: se puede fijar solo el que la heurística resuelve mal.
 */
export type FormFieldMapping = Partial<
  Record<CampoDelCliente | CampoDeEncuesta, string>
>;

/** Alias que se buscan cuando el gym no declaró el mapeo. */
const ALIAS_POR_CAMPO: Record<CampoDelCliente | CampoDeEncuesta, string[]> = {
  nombre: ['nombre', 'name'],
  documento: ['documento', 'dni'],
  telefono: ['telefono', 'phone', 'celular', 'whatsapp'],
  email: ['email', 'correo', 'mail'],
  edad: ['edad', 'age', 'años'],
  // "Objetivos con el entrenamiento" empieza con "objetivo", así que puntúa 2 y le
  // gana a cualquier pregunta que apenas lo contenga.
  objetivo: ['objetivo', 'objetivos', 'meta', 'goal'],
  lesiones: ['lesiones', 'lesion', 'dolencias', 'molestias'],
  diasPorSemana: [
    'cantidad de dias',
    'dias a la semana',
    'dias por semana',
    'frecuencia',
    'entrenamientos_por_semana',
  ],
};

/** Sin tildes, sin mayúsculas, sin espacios al borde: "Teléfono " → "telefono". */
const normalizar = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * Primer valor útil de una respuesta. Las preguntas de opción múltiple llegan como
 * array; el resto, como escalar.
 */
const aTexto = (valor: unknown): string | null => {
  const crudo = Array.isArray(valor) ? valor[0] : valor;

  if (crudo === null || crudo === undefined) {
    return null;
  }

  const texto = String(crudo).trim();
  return texto.length > 0 ? texto : null;
};

/**
 * Todas las opciones elegidas, unidas por coma.
 *
 * Es la lectura correcta para lo que va al prompt: en una pregunta de casillas,
 * quedarse con la primera opción tiraría la mitad de lo que el socio pidió, y el
 * modelo armaría la rutina ignorando la otra mitad sin que nada falle a la vista.
 * Para los campos del cliente sigue valiendo `aTexto`: un DNI no es una lista.
 */
const aTextoCompleto = (valor: unknown): string | null => {
  if (!Array.isArray(valor)) {
    return aTexto(valor);
  }

  const partes = valor
    .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
    .filter((v) => v.length > 0);

  return partes.length > 0 ? partes.join(', ') : null;
};

type Conversor = (valor: unknown) => string | null;

/** Busca una pregunta por su título, tolerando tildes y mayúsculas distintas. */
const valorPorTitulo = (
  respuestas: Record<string, any>,
  titulo: string,
  convertir: Conversor
): string | null => {
  if (Object.prototype.hasOwnProperty.call(respuestas, titulo)) {
    return convertir(respuestas[titulo]);
  }

  const buscado = normalizar(titulo);
  const clave = Object.keys(respuestas).find((k) => normalizar(k) === buscado);

  return clave !== undefined ? convertir(respuestas[clave]) : null;
};

/**
 * Puntúa qué tan bien el título de una pregunta representa a un alias.
 *
 * El puntaje es lo que evita el error clásico de la heurística anterior, que se
 * quedaba con la primera coincidencia parcial: con las preguntas
 * "Nombre completo" y "¿Cuál es tu nombre de usuario de Instagram?", ambas
 * contienen "nombre", pero solo la primera EMPIEZA con esa palabra.
 */
const puntuar = (titulo: string, alias: string): number => {
  const t = normalizar(titulo);
  const a = normalizar(alias);

  if (t === a) return 3;
  if (t.startsWith(a)) return 2;
  if (t.includes(a)) return 1;
  return 0;
};

const buscarPorAlias = (
  respuestas: Record<string, any>,
  alias: string[],
  convertir: Conversor
): string | null => {
  let mejorPuntaje = 0;
  let mejorValor: string | null = null;

  // Se recorren las preguntas en su orden original y los alias en orden de
  // preferencia. Ante empate gana la primera pregunta del formulario, así que el
  // resultado es estable y no depende del orden de iteración de las claves.
  for (const titulo of Object.keys(respuestas)) {
    for (const unAlias of alias) {
      const puntaje = puntuar(titulo, unAlias);

      if (puntaje > mejorPuntaje) {
        const valor = convertir(respuestas[titulo]);

        // Una pregunta sin contestar no puede ganarle a una peor puntuada que sí
        // tiene dato: el objetivo es completar la ficha, no acertar el título.
        if (valor !== null) {
          mejorPuntaje = puntaje;
          mejorValor = valor;
        }
      }
    }
  }

  return mejorValor;
};

/**
 * Devuelve el valor del campo, o `null` si el formulario no lo trae.
 *
 * Si el gym declaró el mapeo para este campo se busca ESA pregunta y ninguna otra:
 * caer a la heurística cuando la pregunta configurada no aparece reintroduciría
 * justamente el error que el mapeo vino a eliminar.
 */
export function extraerCampoDelCliente(
  respuestas: Record<string, any>,
  campo: CampoDelCliente,
  mapping?: FormFieldMapping
): string | null {
  return extraer(respuestas, campo, mapping, aTexto);
}

/**
 * Valor de un campo de la encuesta para inyectar en el prompt, o `null` si el
 * formulario no lo trae.
 *
 * Misma resolución que los campos del cliente —mapeo explícito primero, heurística
 * después— pero une las opciones múltiples en vez de quedarse con la primera: acá
 * el valor va a un texto que lee un modelo, no a una columna.
 */
export function extraerCampoDeEncuesta(
  respuestas: Record<string, any>,
  campo: CampoDeEncuesta,
  mapping?: FormFieldMapping
): string | null {
  return extraer(respuestas, campo, mapping, aTextoCompleto);
}

const extraer = (
  respuestas: Record<string, any>,
  campo: CampoDelCliente | CampoDeEncuesta,
  mapping: FormFieldMapping | undefined,
  convertir: Conversor
): string | null => {
  const tituloConfigurado = mapping?.[campo];

  if (tituloConfigurado) {
    return valorPorTitulo(respuestas, tituloConfigurado, convertir);
  }

  return buscarPorAlias(respuestas, ALIAS_POR_CAMPO[campo], convertir);
};

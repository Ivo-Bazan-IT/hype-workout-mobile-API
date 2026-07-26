import { ValidationError } from '../../shared/errors/AppError';

/**
 * Plantilla del PDF de la rutina: qué HTML se estampa sobre el fondo.
 *
 * Módulo puro: sin Puppeteer, sin pdf-lib, sin `fs`. Vive en el dominio por la
 * misma razón que `promptTemplate.ts` — qué datos del socio pueden aparecer en el
 * documento que se le manda es una regla de negocio, no un detalle del renderer.
 *
 * El PDF se arma en dos capas:
 *   fondo (PDF diseñado, con el arte del gimnasio)  +  contenido (este HTML)
 * El HTML NO debe pintar su propio fondo: taparía el diseño. Ver PuppeteerPdfGenerator.
 */

/** De dónde salió la plantilla usada. */
export type FuentePlantillaPdf = 'gym' | 'standard';

/**
 * Placeholders admitidos en la plantilla, con el mismo formato `{{nombre}}` que ya
 * usa el prompt de IA. Cualquier otro se rechaza al guardar: si se colara, saldría
 * impreso literal en el PDF que recibe el socio.
 */
export const PLACEHOLDERS_PDF = [
  'clienteNombre',
  'gymNombre',
  'fechaGeneracion',
  'fechaVencimiento',
  'rutina',
] as const;

export type PlaceholderPdf = (typeof PLACEHOLDERS_PDF)[number];

/** Sin este placeholder el PDF sale sin la rutina: es todo el punto del documento. */
export const PLACEHOLDER_OBLIGATORIO: PlaceholderPdf = 'rutina';

/**
 * Tope de tamaño de la plantilla propia de un gym.
 *
 * Se guarda como string dentro del documento del gym (igual que
 * `aiConfig.promptTemplate`), y un documento de Mongo no puede pasar los 16 MB.
 * 200 KB alcanza de sobra para HTML+CSS y deja el margen lejos del límite; lo que
 * NO entra son imágenes embebidas en base64, que es justamente lo que hay que
 * evitar: el logo va por URL.
 */
export const MAX_BYTES_PLANTILLA = 200 * 1024;

export interface PlantillaPdf {
  htmlTemplate: string;
  cssStyles?: string;
}

export interface PlantillaPdfResuelta extends PlantillaPdf {
  /** PDF de fondo sobre el que se estampa el HTML. `null` = sin fondo. */
  fondo: Buffer | null;
  fuente: FuentePlantillaPdf;
}

const REGEX_PLACEHOLDER = /\{\{\s*([\w]+)\s*\}\}/g;

/** Placeholders que aparecen en un template, sin repetidos y en orden de aparición. */
export const extractPlaceholdersPdf = (template: string): string[] => {
  const encontrados = new Set<string>();

  for (const match of template.matchAll(REGEX_PLACEHOLDER)) {
    encontrados.add(match[1]);
  }

  return [...encontrados];
};

/**
 * Valida la plantilla que sube un gimnasio. Lanza `ValidationError` con el detalle
 * para que el dueño pueda corregirla, en vez de descubrir el problema cuando un
 * socio recibe un PDF roto.
 */
export const validateRoutinePdfTemplate = (template: string): void => {
  if (!template || !template.trim()) {
    throw new ValidationError('The PDF template cannot be empty.');
  }

  if (Buffer.byteLength(template, 'utf8') > MAX_BYTES_PLANTILLA) {
    throw new ValidationError(
      `The PDF template exceeds ${MAX_BYTES_PLANTILLA / 1024}KB. ` +
        'Do not embed images as base64: reference them by URL instead.'
    );
  }

  const usados = extractPlaceholdersPdf(template);

  const desconocidos = usados.filter(
    (p) => !PLACEHOLDERS_PDF.includes(p as PlaceholderPdf)
  );
  if (desconocidos.length > 0) {
    throw new ValidationError(
      `Unknown placeholders in the PDF template: ${desconocidos.join(', ')}. ` +
        `Available: ${PLACEHOLDERS_PDF.join(', ')}.`
    );
  }

  if (!usados.includes(PLACEHOLDER_OBLIGATORIO)) {
    throw new ValidationError(
      `The PDF template must include {{${PLACEHOLDER_OBLIGATORIO}}}, ` +
        'otherwise the generated PDF would not contain the routine.'
    );
  }
};

/**
 * Elige qué plantilla se usa para un gym: la propia si cargó una, la standard de
 * la plataforma si no.
 *
 * El fondo se resuelve por separado del HTML a propósito: hoy la subida de un PDF
 * de fondo propio NO está implementada (ver `PdfTemplate.storagePath`), así que un
 * gym con HTML propio se sigue estampando sobre el fondo standard. Cuando exista
 * la subida, alcanza con pasarle un `fondoDelGym` distinto de null.
 */
export const resolverPlantillaPdf = (
  delGym: Partial<PlantillaPdf> | undefined,
  standard: PlantillaPdfResuelta,
  fondoDelGym: Buffer | null = null
): PlantillaPdfResuelta => {
  const htmlDelGym = delGym?.htmlTemplate?.trim();

  if (htmlDelGym) {
    return {
      htmlTemplate: htmlDelGym,
      cssStyles: delGym?.cssStyles,
      fondo: fondoDelGym ?? standard.fondo,
      fuente: 'gym',
    };
  }

  return { ...standard, fuente: 'standard' };
};

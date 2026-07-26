import { describe, it, expect } from 'vitest';
import {
  MAX_BYTES_PLANTILLA,
  extractPlaceholdersPdf,
  resolverPlantillaPdf,
  validateRoutinePdfTemplate,
} from '../../../src/domain/pdf/routineTemplate';
import { PlantillaPdfResuelta } from '../../../src/domain/pdf/routineTemplate';

const standard: PlantillaPdfResuelta = {
  htmlTemplate: '<h1>{{clienteNombre}}</h1>{{rutina}}',
  fondo: Buffer.from('%PDF-standard'),
  fuente: 'standard',
};

describe('extractPlaceholdersPdf', () => {
  it('extrae los placeholders sin repetidos y tolera espacios internos', () => {
    const usados = extractPlaceholdersPdf(
      '{{clienteNombre}} {{ rutina }} {{clienteNombre}}'
    );

    expect(usados).toEqual(['clienteNombre', 'rutina']);
  });
});

describe('validateRoutinePdfTemplate', () => {
  it('acepta una plantilla con placeholders conocidos', () => {
    expect(() =>
      validateRoutinePdfTemplate('<h1>{{clienteNombre}}</h1>{{rutina}}')
    ).not.toThrow();
  });

  it('rechaza una plantilla vacía', () => {
    expect(() => validateRoutinePdfTemplate('   ')).toThrow('cannot be empty');
  });

  it('rechaza un placeholder desconocido y lista los válidos', () => {
    // Un typo se imprimiría literal en el PDF que recibe el socio
    expect(() =>
      validateRoutinePdfTemplate('{{rutina}} {{clienteApellido}}')
    ).toThrow('clienteApellido');
  });

  it('exige {{rutina}}: sin eso el PDF no tiene la rutina', () => {
    expect(() => validateRoutinePdfTemplate('<h1>{{clienteNombre}}</h1>')).toThrow(
      '{{rutina}}'
    );
  });

  it('rechaza plantillas por encima del tope de tamaño', () => {
    const gigante = '{{rutina}}' + 'x'.repeat(MAX_BYTES_PLANTILLA);

    // El caso real es una imagen embebida en base64: no entra en el documento
    expect(() => validateRoutinePdfTemplate(gigante)).toThrow('base64');
  });
});

describe('resolverPlantillaPdf', () => {
  it('usa la standard si el gym no cargó ninguna', () => {
    expect(resolverPlantillaPdf(undefined, standard)).toEqual(standard);
    expect(resolverPlantillaPdf({}, standard).fuente).toBe('standard');
  });

  it('ignora una plantilla del gym que sea solo espacios', () => {
    const resuelta = resolverPlantillaPdf({ htmlTemplate: '   ' }, standard);

    expect(resuelta.fuente).toBe('standard');
    expect(resuelta.htmlTemplate).toBe(standard.htmlTemplate);
  });

  it('prioriza la plantilla del gym cuando cargó una', () => {
    const resuelta = resolverPlantillaPdf(
      { htmlTemplate: '<p>propia {{rutina}}</p>', cssStyles: 'p{color:red}' },
      standard
    );

    expect(resuelta.fuente).toBe('gym');
    expect(resuelta.htmlTemplate).toBe('<p>propia {{rutina}}</p>');
    expect(resuelta.cssStyles).toBe('p{color:red}');
  });

  it('estampa el HTML propio del gym sobre el fondo standard', () => {
    // Todavía no hay endpoint para subir un fondo propio: el arte sigue siendo
    // el de la plataforma aunque el contenido sea del gym
    const resuelta = resolverPlantillaPdf({ htmlTemplate: '{{rutina}}' }, standard);

    expect(resuelta.fondo).toBe(standard.fondo);
  });

  it('usa el fondo propio del gym cuando exista la subida', () => {
    const fondoPropio = Buffer.from('%PDF-del-gym');

    const resuelta = resolverPlantillaPdf(
      { htmlTemplate: '{{rutina}}' },
      standard,
      fondoPropio
    );

    expect(resuelta.fondo).toBe(fondoPropio);
  });

  it('mantiene el fondo standard aunque falte (sin fondo no se rompe nada)', () => {
    const sinFondo: PlantillaPdfResuelta = { ...standard, fondo: null };

    expect(resolverPlantillaPdf(undefined, sinFondo).fondo).toBeNull();
  });
});

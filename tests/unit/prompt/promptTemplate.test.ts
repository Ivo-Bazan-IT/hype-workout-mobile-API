import { describe, it, expect } from 'vitest';
import {
  renderPromptTemplate,
  validatePromptTemplate,
  extractPlaceholders,
  PROMPT_PLACEHOLDERS,
} from '../../../src/domain/prompt/promptTemplate';

const context = {
  encuestaData: { objetivo: 'Hipertrofia', dias: 4 },
  clienteNombre: 'Iván Bazán',
  clienteDocumento: '40123456',
  clienteEmail: 'ivan@example.com',
  clienteTelefono: '5491122334455',
  clienteFechaInicio: new Date('2026-07-24T00:00:00.000Z'),
  clienteFechaVencimiento: new Date('2026-08-23T00:00:00.000Z'),
  gymNombre: 'Hype Workout',
};

describe('renderPromptTemplate', () => {
  it('inyecta los datos del cliente y del gym', () => {
    const resultado = renderPromptTemplate(
      'Gym: {{gym_nombre}}. Cliente: {{cliente_nombre}} (DNI {{cliente_documento}}). Encuesta: {{respuestas_encuesta}}',
      context
    );

    expect(resultado).toContain('Gym: Hype Workout');
    expect(resultado).toContain('Cliente: Iván Bazán (DNI 40123456)');
    expect(resultado).toContain('"objetivo": "Hipertrofia"');
  });

  it('reemplaza TODAS las apariciones del mismo placeholder', () => {
    // El .replace() con string que había en los adaptadores solo sustituía la primera
    const resultado = renderPromptTemplate(
      'Hola {{cliente_nombre}}, esta rutina es para {{cliente_nombre}}. Chau {{cliente_nombre}}.',
      context
    );

    expect(resultado).toBe('Hola Iván Bazán, esta rutina es para Iván Bazán. Chau Iván Bazán.');
  });

  it('tolera espacios dentro de las llaves', () => {
    expect(renderPromptTemplate('{{ cliente_nombre }}', context)).toBe('Iván Bazán');
  });

  it('usa "no informado" para los datos opcionales ausentes', () => {
    const resultado = renderPromptTemplate('Tel: {{cliente_telefono}} / Mail: {{cliente_email}}', {
      ...context,
      clienteTelefono: undefined,
      clienteEmail: undefined,
    });

    expect(resultado).toBe('Tel: no informado / Mail: no informado');
  });

  it('deja intacto un placeholder desconocido en vez de romper', () => {
    const resultado = renderPromptTemplate('{{cliente_nombre}} y {{inexistente}}', context);
    expect(resultado).toBe('Iván Bazán y {{inexistente}}');
  });

  it('resuelve todos los placeholders del catálogo', () => {
    const template = PROMPT_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' | ');
    const resultado = renderPromptTemplate(template, context);

    expect(resultado).not.toContain('{{');
  });
});

describe('validatePromptTemplate', () => {
  it('acepta un template con al menos un placeholder conocido', () => {
    const template =
      'Sos el entrenador de Hype Workout. Equipamiento: 4 racks, 2 prensas, poleas. ' +
      'Diseñá la rutina para: {{respuestas_encuesta}}';

    expect(validatePromptTemplate(template)).toBeNull();
  });

  it('rechaza un template sin ningún placeholder', () => {
    const error = validatePromptTemplate('Generá una rutina de musculación de 4 días.');

    expect(error).toContain('must include at least one placeholder');
    expect(error).toContain('{{respuestas_encuesta}}');
  });

  it('rechaza placeholders desconocidos (typos que se enviarían literales)', () => {
    const error = validatePromptTemplate('Rutina para {{respuestas_encuesta}} usando {{maquinaria}}');

    expect(error).toContain('Unknown placeholders');
    expect(error).toContain('{{maquinaria}}');
  });

  it('acepta el default que se asigna al crear un gym', () => {
    expect(validatePromptTemplate('{{respuestas_encuesta}}')).toBeNull();
  });
});

describe('extractPlaceholders', () => {
  it('devuelve los placeholders usados sin repetir', () => {
    expect(
      extractPlaceholders('{{cliente_nombre}} {{respuestas_encuesta}} {{cliente_nombre}}')
    ).toEqual(['cliente_nombre', 'respuestas_encuesta']);
  });

  it('devuelve vacío cuando no hay placeholders', () => {
    expect(extractPlaceholders('texto plano')).toEqual([]);
  });
});

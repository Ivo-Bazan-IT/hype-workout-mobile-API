import { describe, it, expect } from 'vitest';
import {
  INSTRUCCION_FORMATO_RUTINA,
  PROMPT_LEGACY_POR_DEFECTO,
  PROMPT_STANDARD,
  resolverPromptTemplate,
} from '../../../src/domain/prompt/promptStandard';
import {
  extractPlaceholders,
  validatePromptTemplate,
} from '../../../src/domain/prompt/promptTemplate';

describe('PROMPT_STANDARD', () => {
  it('pasa la validación que se le exige al prompt de cualquier gym', () => {
    // Si el standard no pasara su propia validación, un gym que lo guarda tal cual
    // desde la pantalla de configuración recibiría un 400
    expect(validatePromptTemplate(PROMPT_STANDARD)).toBeNull();
  });

  it('inyecta la encuesta, que es el insumo que personaliza la rutina', () => {
    expect(extractPlaceholders(PROMPT_STANDARD)).toContain('respuestas_encuesta');
  });

  it('no define el formato JSON: eso es responsabilidad de la plataforma', () => {
    // Si el formato viviera acá, un gym que edita su prompt podría romper el
    // contrato con el renderer del PDF sin darse cuenta
    expect(PROMPT_STANDARD).not.toContain('"dias"');
    expect(INSTRUCCION_FORMATO_RUTINA).toContain('"dias"');
  });
});

describe('INSTRUCCION_FORMATO_RUTINA', () => {
  it('declara los campos exactos que lee el renderer del PDF', () => {
    // renderRoutineAsHtml / renderDia leen estas claves: si cambian en un lado y
    // no en el otro, el PDF cae al volcado crudo del JSON
    for (const campo of [
      'dias',
      'nombre',
      'ejercicios',
      'series',
      'repeticiones',
      'descanso',
      'notas',
      'observaciones',
    ]) {
      expect(INSTRUCCION_FORMATO_RUTINA, campo).toContain(`"${campo}"`);
    }
  });
});

describe('resolverPromptTemplate', () => {
  it('usa el prompt del gym cuando escribió uno', () => {
    const propio = 'Sos el coach de {{gym_nombre}}. Encuesta: {{respuestas_encuesta}}';

    expect(resolverPromptTemplate(propio)).toEqual({
      template: propio,
      fuente: 'gym',
    });
  });

  it('cae al standard si el gym no tiene prompt', () => {
    expect(resolverPromptTemplate(undefined).fuente).toBe('standard');
    expect(resolverPromptTemplate('').fuente).toBe('standard');
    expect(resolverPromptTemplate('    ').fuente).toBe('standard');
  });

  it('trata el default viejo del alta como "sin configurar"', () => {
    // '{{respuestas_encuesta}}' nunca lo escribió un dueño: lo ponía CreateGymUseCase.
    // Respetarlo dejaría a todos los gyms creados hasta ahora mandándole al modelo
    // un volcado de datos sin ninguna consigna.
    const resuelto = resolverPromptTemplate(PROMPT_LEGACY_POR_DEFECTO);

    expect(resuelto.fuente).toBe('standard');
    expect(resuelto.template).toBe(PROMPT_STANDARD);
  });

  it('respeta un prompt del gym que contenga el placeholder de la encuesta', () => {
    // No confundir con el legacy: acá el dueño SÍ escribió algo alrededor
    const propio = 'Tenemos solo mancuernas. Encuesta: {{respuestas_encuesta}}';

    expect(resolverPromptTemplate(propio).fuente).toBe('gym');
  });
});

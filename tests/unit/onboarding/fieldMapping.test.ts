import { describe, it, expect } from 'vitest';
import {
  extraerCampoDeEncuesta,
  extraerCampoDelCliente,
} from '../../../src/domain/forms/fieldMapping';

/** Las siete preguntas del formulario "Proceso de Inscripción", tal cual. */
const FORMULARIO_REAL = {
  'Nombre completo': 'Iván Bazán',
  'DNI': '40123456',
  'Numero de telefono': '5491122334455',
  'Edad': '30',
  'Objetivos con el entrenamiento': 'Ganar masa muscular',
  'Lesiones en curso': 'Ninguna',
  'Cantidad de dias a la semana que podra entrenar': '3 dias',
};

describe('extraerCampoDelCliente', () => {
  describe('sin mapeo configurado (heurística por alias)', () => {
    it('resuelve los títulos habituales de un formulario en español', () => {
      const respuestas = {
        'Nombre completo': 'Iván Bazán',
        'DNI': '40123456',
        'Teléfono': '5491122334455',
        'Email': 'ivan@example.com',
      };

      expect(extraerCampoDelCliente(respuestas, 'nombre')).toBe('Iván Bazán');
      expect(extraerCampoDelCliente(respuestas, 'documento')).toBe('40123456');
      expect(extraerCampoDelCliente(respuestas, 'telefono')).toBe('5491122334455');
      expect(extraerCampoDelCliente(respuestas, 'email')).toBe('ivan@example.com');
    });

    it('prefiere la pregunta que EMPIEZA con el alias sobre la que solo lo contiene', () => {
      // Este es el caso que rompía la heurística anterior: se quedaba con la
      // primera coincidencia parcial y devolvía el usuario de Instagram.
      const respuestas = {
        '¿Cuál es tu nombre de usuario de Instagram?': '@ivanbzn',
        'Nombre completo': 'Iván Bazán',
      };

      expect(extraerCampoDelCliente(respuestas, 'nombre')).toBe('Iván Bazán');
    });

    it('prefiere la coincidencia exacta sobre la parcial', () => {
      const respuestas = {
        'Documento de quien te recomendó': '30111222',
        'Documento': '40123456',
      };

      expect(extraerCampoDelCliente(respuestas, 'documento')).toBe('40123456');
    });

    it('ignora tildes y mayúsculas al comparar', () => {
      expect(extraerCampoDelCliente({ 'TELÉFONO': '549112233' }, 'telefono')).toBe(
        '549112233'
      );
    });

    it('toma el primer valor de las preguntas de opción múltiple', () => {
      const respuestas = { 'Teléfono de contacto': ['5491122334455', '5491199887766'] };

      expect(extraerCampoDelCliente(respuestas, 'telefono')).toBe('5491122334455');
    });

    it('devuelve null si ninguna pregunta corresponde al campo', () => {
      const respuestas = { '¿Cuál es tu objetivo?': 'Ganar masa muscular' };

      expect(extraerCampoDelCliente(respuestas, 'documento')).toBeNull();
    });

    it('trata las respuestas en blanco como ausentes', () => {
      expect(extraerCampoDelCliente({ Email: '   ' }, 'email')).toBeNull();
    });

    it('prefiere una pregunta peor puntuada con dato antes que la mejor vacía', () => {
      const respuestas = {
        'Teléfono': '',
        'Teléfono alternativo': '5491199887766',
      };

      expect(extraerCampoDelCliente(respuestas, 'telefono')).toBe('5491199887766');
    });
  });

  describe('con mapeo configurado por el gym', () => {
    it('usa la pregunta declarada aunque otra puntúe mejor en la heurística', () => {
      const respuestas = {
        'Nombre completo': 'Nombre de quien lo trajo',
        '¿Cómo querés que te llamemos?': 'Iván',
      };

      const resultado = extraerCampoDelCliente(respuestas, 'nombre', {
        nombre: '¿Cómo querés que te llamemos?',
      });

      expect(resultado).toBe('Iván');
    });

    it('NO cae a la heurística si la pregunta declarada no está en la submission', () => {
      // Adivinar acá reintroduciría el error que el mapeo vino a eliminar.
      const respuestas = { 'Nombre completo': 'Iván Bazán' };

      const resultado = extraerCampoDelCliente(respuestas, 'nombre', {
        nombre: 'Pregunta que se renombró',
      });

      expect(resultado).toBeNull();
    });

    it('tolera diferencias de tilde y mayúscula entre lo configurado y el Form', () => {
      const resultado = extraerCampoDelCliente({ 'Teléfono': '549112233' }, 'telefono', {
        telefono: 'telefono',
      });

      expect(resultado).toBe('549112233');
    });

    it('aplica la heurística a los campos que el mapeo no declara', () => {
      const respuestas = {
        'Su documento': '40123456',
        'DNI del titular': '30111222',
      };

      // Solo se fija `documento`; `nombre` sigue resolviéndose solo.
      const documento = extraerCampoDelCliente(respuestas, 'documento', {
        documento: 'Su documento',
      });
      const nombre = extraerCampoDelCliente(respuestas, 'nombre', {
        documento: 'Su documento',
      });

      expect(documento).toBe('40123456');
      expect(nombre).toBeNull();
    });
  });
});

describe('el formulario real "Proceso de Inscripción"', () => {
  it('resuelve los tres campos del cliente sin mapeo configurado', () => {
    // "DNI" matchea exacto, "Nombre completo" empieza con el alias y
    // "Numero de telefono" lo contiene. El form no pregunta email.
    expect(extraerCampoDelCliente(FORMULARIO_REAL, 'nombre')).toBe('Iván Bazán');
    expect(extraerCampoDelCliente(FORMULARIO_REAL, 'documento')).toBe('40123456');
    expect(extraerCampoDelCliente(FORMULARIO_REAL, 'telefono')).toBe('5491122334455');
    expect(extraerCampoDelCliente(FORMULARIO_REAL, 'email')).toBeNull();
  });

  it('resuelve los cuatro campos de encuesta sin mapeo configurado', () => {
    expect(extraerCampoDeEncuesta(FORMULARIO_REAL, 'edad')).toBe('30');
    expect(extraerCampoDeEncuesta(FORMULARIO_REAL, 'objetivo')).toBe('Ganar masa muscular');
    expect(extraerCampoDeEncuesta(FORMULARIO_REAL, 'lesiones')).toBe('Ninguna');
    expect(extraerCampoDeEncuesta(FORMULARIO_REAL, 'diasPorSemana')).toBe('3 dias');
  });
});

describe('extraerCampoDeEncuesta', () => {
  it('une todas las opciones de una pregunta de casillas', () => {
    const respuestas = {
      'Objetivos con el entrenamiento': ['Perder peso', 'Flexibilidad y movilidad'],
    };

    // Quedarse con la primera tiraría la mitad de lo que el socio pidió, y el modelo
    // armaría la rutina ignorándola sin que nada falle a la vista.
    expect(extraerCampoDeEncuesta(respuestas, 'objetivo')).toBe(
      'Perder peso, Flexibilidad y movilidad'
    );
  });

  it('descarta las opciones vacías al unir', () => {
    const respuestas = { 'Objetivos con el entrenamiento': ['Perder peso', '', null] };

    expect(extraerCampoDeEncuesta(respuestas, 'objetivo')).toBe('Perder peso');
  });

  it('devuelve null cuando la pregunta no está en el formulario', () => {
    expect(extraerCampoDeEncuesta({ 'DNI': '40123456' }, 'lesiones')).toBeNull();
  });

  it('respeta el mapeo explícito del gym por sobre la heurística', () => {
    const respuestas = {
      'Objetivo del acompañante': 'Otra cosa',
      '¿Para qué venís al gimnasio?': 'Preparacion deportiva',
    };

    expect(
      extraerCampoDeEncuesta(respuestas, 'objetivo', {
        objetivo: '¿Para qué venís al gimnasio?',
      })
    ).toBe('Preparacion deportiva');
  });

  it('no cae a la heurística si la pregunta mapeada no aparece', () => {
    const respuestas = { 'Objetivos con el entrenamiento': 'Ganar masa muscular' };

    // Caer a adivinar reintroduciría el error que el mapeo vino a eliminar: el gym
    // renombró la pregunta y tiene que enterarse.
    expect(
      extraerCampoDeEncuesta(respuestas, 'objetivo', { objetivo: 'Pregunta que ya no existe' })
    ).toBeNull();
  });
});

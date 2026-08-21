import { describe, it, expect } from 'vitest';
import {
  VIGENCIA_RUTINA_DIAS,
  calcularVencimientoRutina,
} from '../../../src/domain/routine/vigencia';

/**
 * La planificación es mensual: generada el día X, vence el día X+30.
 *
 * Está probado aparte del caso de uso porque es la regla, no el trámite: el día que
 * la vigencia deje de ser mensual, este archivo es el que tiene que cambiar.
 */
describe('calcularVencimientoRutina', () => {
  it('vence a los 30 días de generada', () => {
    expect(VIGENCIA_RUTINA_DIAS).toBe(30);

    const generada = new Date(2026, 7, 19); // 19 de agosto
    expect(calcularVencimientoRutina(generada)).toEqual(new Date(2026, 8, 18)); // 18 de septiembre
  });

  it('cruza el fin de mes contando días, no sumando un mes', () => {
    // Enero tiene 31 días: sumar "un mes" daría el 31/01 y serían 31 días de plan.
    // Los meses cortos y largos harían durar distinto a dos rutinas del mismo precio.
    expect(calcularVencimientoRutina(new Date(2026, 0, 1))).toEqual(new Date(2026, 0, 31));
    expect(calcularVencimientoRutina(new Date(2026, 1, 1))).toEqual(new Date(2026, 2, 3));
  });

  it('cruza el fin de año', () => {
    expect(calcularVencimientoRutina(new Date(2026, 11, 20))).toEqual(new Date(2027, 0, 19));
  });

  it('conserva la hora del día', () => {
    const generada = new Date(2026, 7, 19, 14, 30, 45);
    const vencimiento = calcularVencimientoRutina(generada);

    expect(vencimiento.getHours()).toBe(14);
    expect(vencimiento.getMinutes()).toBe(30);
    expect(vencimiento.getSeconds()).toBe(45);
  });

  /*
   * Devolver la misma instancia mutada dejaría al llamador con la fecha de
   * generación corrida treinta días hacia adelante. Aparecería como "la rutina
   * figura generada en el futuro", lejos de acá y sin pista de por qué.
   */
  it('no muta la fecha que recibe', () => {
    const generada = new Date(2026, 7, 19);
    const copia = new Date(generada);

    calcularVencimientoRutina(generada);

    expect(generada).toEqual(copia);
  });
});

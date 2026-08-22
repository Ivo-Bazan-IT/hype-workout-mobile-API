import { describe, it, expect } from 'vitest';
import { calcularNuevoVencimiento } from '../../../src/domain/billing/planesMembresia';

describe('calcularNuevoVencimiento', () => {
  it('un socio vencido arranca de HOY, no del vencimiento viejo', () => {
    const vencimientoViejo = new Date('2020-01-01T00:00:00.000Z');
    const antes = new Date();

    const resultado = calcularNuevoVencimiento(vencimientoViejo, 30);

    const esperadoMin = new Date(antes);
    esperadoMin.setDate(esperadoMin.getDate() + 30);

    // No arrastra los años que estuvo vencido: el resultado está cerca de
    // "hoy + 30 días", no de "2020-01-01 + 30 días".
    expect(resultado.getTime()).toBeGreaterThanOrEqual(esperadoMin.getTime() - 1000);
  });

  it('un socio que renueva ANTES de vencer extiende desde su vencimiento real', () => {
    const enElFuturo = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // vence en 10 días

    const resultado = calcularNuevoVencimiento(enElFuturo, 30);

    const esperado = new Date(enElFuturo);
    esperado.setDate(esperado.getDate() + 30);

    expect(resultado.getTime()).toBe(esperado.getTime());
  });

  it('no muta la fecha que recibe', () => {
    const vencimientoActual = new Date('2026-01-01T00:00:00.000Z');
    const copia = new Date(vencimientoActual);

    calcularNuevoVencimiento(vencimientoActual, 90);

    expect(vencimientoActual.getTime()).toBe(copia.getTime());
  });
});

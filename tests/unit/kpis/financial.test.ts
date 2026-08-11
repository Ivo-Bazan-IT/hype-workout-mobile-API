import { describe, it, expect } from 'vitest';
import {
  arpu,
  lifetimeValue,
  mrr,
  netMrrGrowth,
  normalizeToMonthlyFee,
} from '../../../src/domain/kpis/financial';

const f = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('normalizeToMonthlyFee', () => {
  it('lleva un pago trimestral a base mensual', () => {
    // $30.000 por 90 días entran al MRR como $10.000, no como $30.000.
    expect(
      normalizeToMonthlyFee({
        monto: 3_000_000,
        inicio: f('2026-01-01'),
        vencimiento: f('2026-04-01'),
      })
    ).toBe(1_000_000);
  });

  it('deja igual una cuota de 30 días', () => {
    expect(
      normalizeToMonthlyFee({
        monto: 1_500_000,
        inicio: f('2026-01-01'),
        vencimiento: f('2026-01-31'),
      })
    ).toBe(1_500_000);
  });

  it('devuelve null si la ventana no tiene duración positiva', () => {
    expect(
      normalizeToMonthlyFee({
        monto: 1_500_000,
        inicio: f('2026-01-31'),
        vencimiento: f('2026-01-31'),
      })
    ).toBeNull();
  });
});

describe('mrr', () => {
  it('suma las cuotas normalizadas', () => {
    expect(mrr([{ monthlyFee: 1_000_000 }, { monthlyFee: 1_500_000 }])).toBe(2_500_000);
  });

  it('sin suscripciones activas el MRR es 0, no null: es un monto, no una tasa', () => {
    expect(mrr([])).toBe(0);
  });
});

describe('netMrrGrowth', () => {
  it('descompone el movimiento del período', () => {
    expect(
      netMrrGrowth({
        newMrr: 500_000,
        expansionMrr: 200_000,
        contractionMrr: 100_000,
        churnedMrr: 300_000,
      })
    ).toBe(300_000);
  });

  it('expone el estancamiento: crecer en altas y perder lo mismo en bajas da 0', () => {
    expect(
      netMrrGrowth({
        newMrr: 400_000,
        expansionMrr: 0,
        contractionMrr: 0,
        churnedMrr: 400_000,
      })
    ).toBe(0);
  });
});

describe('arpu', () => {
  it('redondea a centavos enteros', () => {
    expect(arpu({ monthlyRevenue: 1_000_000, activeMembers: 3 })).toBe(333_333);
  });

  it('devuelve null sin socios activos', () => {
    expect(arpu({ monthlyRevenue: 1_000_000, activeMembers: 0 })).toBeNull();
  });
});

describe('lifetimeValue', () => {
  it('sin margen declarado devuelve LTV sobre ingreso', () => {
    expect(lifetimeValue({ arpu: 500_000, monthlyChurnRate: 0.05 })).toBe(10_000_000);
  });

  it('reducir el churn a la mitad duplica el LTV', () => {
    const conChurnAlto = lifetimeValue({ arpu: 500_000, monthlyChurnRate: 0.05 })!;
    const conChurnBajo = lifetimeValue({ arpu: 500_000, monthlyChurnRate: 0.025 })!;

    expect(conChurnBajo).toBe(conChurnAlto * 2);
  });

  it('aplica el margen bruto cuando se lo pasa', () => {
    expect(
      lifetimeValue({ arpu: 500_000, monthlyChurnRate: 0.05, grossMargin: 0.6 })
    ).toBe(6_000_000);
  });

  it('devuelve null con churn 0: el LTV tendería a infinito', () => {
    expect(lifetimeValue({ arpu: 500_000, monthlyChurnRate: 0 })).toBeNull();
  });
});

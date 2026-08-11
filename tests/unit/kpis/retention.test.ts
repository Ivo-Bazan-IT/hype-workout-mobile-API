import { describe, it, expect } from 'vitest';
import {
  CohortMember,
  cohortRetention,
  monthlyChurnRate,
  retentionRate,
} from '../../../src/domain/kpis/retention';

const f = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('monthlyChurnRate', () => {
  it('divide las bajas por la base al inicio del período', () => {
    expect(monthlyChurnRate({ membersAtStart: 200, cancelledDuringPeriod: 8 })).toBe(0.04);
  });

  it('devuelve null sin base al inicio: no es 0% de churn, es una tasa indefinida', () => {
    expect(monthlyChurnRate({ membersAtStart: 0, cancelledDuringPeriod: 0 })).toBeNull();
  });

  it('devuelve 0 cuando hay base y nadie se fue', () => {
    expect(monthlyChurnRate({ membersAtStart: 50, cancelledDuringPeriod: 0 })).toBe(0);
  });
});

describe('retentionRate', () => {
  it('excluye las altas nuevas del numerador', () => {
    // 100 al inicio, 110 al final, pero 20 son nuevos: se retuvieron 90.
    expect(
      retentionRate({ membersAtStart: 100, membersAtEnd: 110, newMembersInPeriod: 20 })
    ).toBe(0.9);
  });

  it('un mes de mucha adquisición no infla la retención', () => {
    // Sin excluir altas daría 1.5, que leería como "retención del 150%".
    expect(
      retentionRate({ membersAtStart: 100, membersAtEnd: 150, newMembersInPeriod: 80 })
    ).toBe(0.7);
  });

  it('devuelve null sin base al inicio', () => {
    expect(
      retentionRate({ membersAtStart: 0, membersAtEnd: 10, newMembersInPeriod: 10 })
    ).toBeNull();
  });
});

describe('cohortRetention', () => {
  const socio = (
    memberId: string,
    joinedAt: string,
    cancelledAt: string | null
  ): CohortMember => ({
    memberId,
    joinedAt: f(joinedAt),
    cancelledAt: cancelledAt === null ? null : f(cancelledAt),
  });

  it('cuenta como sobreviviente al que superó la ventana antes de irse', () => {
    const cohort = [
      socio('a', '2026-01-01', null), // sigue activo
      socio('b', '2026-01-01', '2026-05-01'), // 120 días: sobrevivió a los 90
      socio('c', '2026-01-01', '2026-02-01'), // 31 días: no llegó
      socio('d', '2026-01-01', '2026-03-01'), // 59 días: no llegó
    ];

    expect(cohortRetention({ cohort, windowDays: 90 })).toBe(0.5);
  });

  it('censura a quien todavía no tuvo tiempo de completar la ventana', () => {
    const cohort = [
      socio('viejo', '2026-01-01', '2026-01-31'), // ventana cumplida, no sobrevivió
      socio('nuevo', '2026-04-20', null), // se anotó hace 10 días
    ];

    // Sin `now` el socio nuevo cuenta como sobreviviente de una ventana que ni
    // siquiera transcurrió, y la cohorte se lee al 50%.
    expect(cohortRetention({ cohort, windowDays: 90 })).toBe(0.5);

    // Con `now` queda fuera del numerador y del denominador.
    expect(cohortRetention({ cohort, windowDays: 90, now: f('2026-04-30') })).toBe(0);
  });

  it('devuelve null con la cohorte vacía', () => {
    expect(cohortRetention({ cohort: [], windowDays: 90 })).toBeNull();
  });

  it('devuelve null cuando ningún socio completó todavía la ventana', () => {
    const cohort = [socio('nuevo', '2026-04-20', null)];

    expect(cohortRetention({ cohort, windowDays: 90, now: f('2026-04-30') })).toBeNull();
  });
});

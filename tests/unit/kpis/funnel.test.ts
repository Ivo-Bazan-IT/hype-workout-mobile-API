import { describe, it, expect } from 'vitest';
import {
  avgLeadResponseMinutes,
  cohortConversionRate,
  leadConversionRate,
  netMemberGrowth,
  newLeadsPerWeek,
  trialConversionByVisits,
  trialConversionRate,
} from '../../../src/domain/kpis/funnel';

const f = (iso: string) => new Date(iso);

describe('newLeadsPerWeek', () => {
  it('normaliza el conteo del período a semanas', () => {
    expect(newLeadsPerWeek({ leadsInPeriod: 40, periodDays: 28 })).toBe(10);
  });

  it('devuelve null con un período sin días', () => {
    expect(newLeadsPerWeek({ leadsInPeriod: 40, periodDays: 0 })).toBeNull();
  });
});

describe('leadConversionRate', () => {
  it('calcula la efectividad del proceso comercial', () => {
    expect(leadConversionRate({ convertedMembers: 12, totalLeads: 40 })).toBe(0.3);
  });

  it('devuelve null sin leads: no hubo embudo que medir', () => {
    expect(leadConversionRate({ convertedMembers: 0, totalLeads: 0 })).toBeNull();
  });
});

describe('avgLeadResponseMinutes', () => {
  it('promedia solo sobre los leads efectivamente contactados', () => {
    const leads = [
      {
        createdAt: f('2026-03-01T10:00:00.000Z'),
        firstContactedAt: f('2026-03-01T10:30:00.000Z'),
      },
      {
        createdAt: f('2026-03-01T12:00:00.000Z'),
        firstContactedAt: f('2026-03-01T13:30:00.000Z'),
      },
      // Nunca contactado: es un problema de cobertura, no de velocidad. Incluirlo
      // acá mezclaría dos diagnósticos con acciones distintas.
      { createdAt: f('2026-03-01T14:00:00.000Z'), firstContactedAt: null },
    ];

    expect(avgLeadResponseMinutes(leads)).toBe(60);
  });

  it('devuelve null si no se contactó a nadie', () => {
    const leads = [{ createdAt: f('2026-03-01T14:00:00.000Z'), firstContactedAt: null }];

    expect(avgLeadResponseMinutes(leads)).toBeNull();
  });

  it('devuelve null sin leads', () => {
    expect(avgLeadResponseMinutes([])).toBeNull();
  });
});

describe('cohortConversionRate', () => {
  const AHORA = f('2026-03-15T12:00:00.000Z');

  const lead = (createdAt: string, convertido: boolean) => ({
    clientId: createdAt,
    createdAt: f(createdAt),
    fechaPrimerContacto: null,
    fechaConversion: null,
    convertido,
  });

  it('excluye del numerador y del denominador a los leads que no cumplieron la ventana', () => {
    const leads = [
      // Maduros: entraron hace más de 90 días.
      lead('2025-10-01T00:00:00.000Z', true),
      lead('2025-10-05T00:00:00.000Z', false),
      // Inmaduro: todavía puede convertir. Contarlo como fracaso sería adelantarse.
      lead('2026-03-10T00:00:00.000Z', false),
    ];

    // 1 de 2, no 1 de 3.
    expect(cohortConversionRate({ leads, windowDays: 90, now: AHORA })).toBe(0.5);
  });

  it('devuelve null cuando ningún lead maduró todavía', () => {
    const leads = [
      lead('2026-03-01T00:00:00.000Z', true),
      lead('2026-03-10T00:00:00.000Z', false),
    ];

    // Es el caso del período por defecto: el mes en curso nunca tiene cohorte madura.
    expect(cohortConversionRate({ leads, windowDays: 90, now: AHORA })).toBeNull();
  });

  it('cuenta como convertido al que no tiene fecha de conversión', () => {
    // Los clientes anteriores a la tanda 4 tienen encuesta pero no `fechaConversion`.
    // Convirtieron de verdad; lo que no se sabe es cuándo.
    const leads = [lead('2025-09-01T00:00:00.000Z', true)];

    expect(cohortConversionRate({ leads, windowDays: 90, now: AHORA })).toBe(1);
  });

  it('devuelve null sin leads', () => {
    expect(cohortConversionRate({ leads: [], windowDays: 90, now: AHORA })).toBeNull();
  });
});

describe('trialConversionRate', () => {
  it('calcula la conversión global de pruebas', () => {
    expect(trialConversionRate({ convertedTrials: 9, totalTrials: 20 })).toBe(0.45);
  });

  it('devuelve null sin pruebas', () => {
    expect(trialConversionRate({ convertedTrials: 0, totalTrials: 0 })).toBeNull();
  });
});

describe('trialConversionByVisits', () => {
  const trials = [
    { visitsDuringTrial: 0, converted: false },
    { visitsDuringTrial: 1, converted: false },
    { visitsDuringTrial: 3, converted: true },
    { visitsDuringTrial: 4, converted: true },
    { visitsDuringTrial: 5, converted: false },
  ];

  it('expone el umbral de visitas que dispara la conversión', () => {
    // La global es 40%; segmentando por 3+ visitas salta a 67%.
    expect(trialConversionRate({ convertedTrials: 2, totalTrials: 5 })).toBe(0.4);
    expect(trialConversionByVisits(trials, 3)).toBeCloseTo(2 / 3);
  });

  it('devuelve null si ningún trial alcanza el mínimo de visitas', () => {
    expect(trialConversionByVisits(trials, 10)).toBeNull();
  });
});

describe('netMemberGrowth', () => {
  it('hace visible el estancamiento que el conteo bruto de altas esconde', () => {
    expect(netMemberGrowth({ newMembers: 8, churnedMembers: 8 })).toBe(0);
  });

  it('puede ser negativo', () => {
    expect(netMemberGrowth({ newMembers: 3, churnedMembers: 10 })).toBe(-7);
  });
});

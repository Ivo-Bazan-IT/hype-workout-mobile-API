import { describe, it, expect } from 'vitest';
import {
  DIAS_MINIMOS_PARA_PROMEDIO_SEMANAL,
  avgVisitsPerMemberPerWeek,
  findAtRiskMembers,
  weeklyClassParticipationRate,
} from '../../../src/domain/kpis/engagement';

const f = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('avgVisitsPerMemberPerWeek', () => {
  it('normaliza por semana para que dos períodos distintos sean comparables', () => {
    const mes = avgVisitsPerMemberPerWeek({
      totalCheckIns: 800,
      activeMembers: 100,
      periodDays: 28,
    });
    const quincena = avgVisitsPerMemberPerWeek({
      totalCheckIns: 400,
      activeMembers: 100,
      periodDays: 14,
    });

    expect(mes).toBe(2);
    expect(quincena).toBe(2);
  });

  it('devuelve null sin socios activos', () => {
    expect(
      avgVisitsPerMemberPerWeek({ totalCheckIns: 10, activeMembers: 0, periodDays: 30 })
    ).toBeNull();
  });

  it('devuelve null con un período sin días', () => {
    expect(
      avgVisitsPerMemberPerWeek({ totalCheckIns: 10, activeMembers: 5, periodDays: 0 })
    ).toBeNull();
  });

  it('devuelve null con horas de registro en vez de extrapolar a la semana', () => {
    // El caso medido en producción: 2 socios, 2 check-ins, ~7 horas de registro.
    // Sin el piso esto daba 23,2 visitas por socio por semana.
    expect(
      avgVisitsPerMemberPerWeek({ totalCheckIns: 2, activeMembers: 2, periodDays: 0.3 })
    ).toBeNull();
  });

  it('devuelve null justo por debajo de la semana', () => {
    expect(
      avgVisitsPerMemberPerWeek({ totalCheckIns: 20, activeMembers: 5, periodDays: 6.9 })
    ).toBeNull();
  });

  it('la semana exacta ya es un promedio válido', () => {
    expect(
      avgVisitsPerMemberPerWeek({ totalCheckIns: 20, activeMembers: 5, periodDays: 7 })
    ).toBe(4);
  });

  it('el piso es exactamente una semana, la unidad de la métrica', () => {
    expect(DIAS_MINIMOS_PARA_PROMEDIO_SEMANAL).toBe(7);
  });
});

describe('findAtRiskMembers', () => {
  const now = f('2026-03-01');

  it('marca a quien no aparece hace más de los días declarados', () => {
    const members = [
      { memberId: 'al-dia', lastCheckInAt: f('2026-02-27') },
      { memberId: 'hace-3-semanas', lastCheckInAt: f('2026-02-08') },
    ];

    expect(findAtRiskMembers({ members, staleDays: 14, now })).toEqual(['hace-3-semanas']);
  });

  it('marca a quien nunca asistió', () => {
    const members = [{ memberId: 'fantasma', lastCheckInAt: null }];

    expect(findAtRiskMembers({ members, staleDays: 14, now })).toEqual(['fantasma']);
  });

  it('el umbral es inclusivo', () => {
    const members = [{ memberId: 'justo', lastCheckInAt: f('2026-02-15') }];

    expect(findAtRiskMembers({ members, staleDays: 14, now })).toEqual(['justo']);
  });

  it('devuelve IDs para que la capa de aplicación dispare la campaña', () => {
    expect(findAtRiskMembers({ members: [], staleDays: 14, now })).toEqual([]);
  });
});

describe('weeklyClassParticipationRate', () => {
  it('calcula la proporción sobre los socios activos', () => {
    expect(
      weeklyClassParticipationRate({ membersWithClassAttendance: 30, activeMembers: 120 })
    ).toBe(0.25);
  });

  it('devuelve null sin socios activos', () => {
    expect(
      weeklyClassParticipationRate({ membersWithClassAttendance: 0, activeMembers: 0 })
    ).toBeNull();
  });
});

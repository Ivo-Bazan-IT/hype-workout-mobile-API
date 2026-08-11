import { describe, it, expect } from 'vitest';
import {
  classOccupancyRate,
  facilityUtilizationRate,
  noShowRate,
} from '../../../src/domain/kpis/operations';

describe('facilityUtilizationRate', () => {
  it('calcula la fracción de capacidad usada', () => {
    expect(facilityUtilizationRate({ slotsUsed: 45, slotsAvailable: 60 })).toBe(0.75);
  });

  it('devuelve null sin capacidad declarada', () => {
    expect(facilityUtilizationRate({ slotsUsed: 45, slotsAvailable: 0 })).toBeNull();
  });
});

describe('classOccupancyRate', () => {
  it('pondera por capacidad y no promedia porcentajes', () => {
    const sessions = [
      { attendees: 4, capacity: 4 }, // 100%
      { attendees: 6, capacity: 30 }, // 20%
    ];

    // El promedio simple de porcentajes daría 60% y leería como una ocupación
    // sana; ponderado por capacidad son 10 de 34 cupos: 29%.
    expect(classOccupancyRate(sessions)).toBeCloseTo(10 / 34);
  });

  it('devuelve null si no hay cupos', () => {
    expect(classOccupancyRate([])).toBeNull();
    expect(classOccupancyRate([{ attendees: 0, capacity: 0 }])).toBeNull();
  });
});

describe('noShowRate', () => {
  it('calcula la proporción de reservas incumplidas', () => {
    expect(noShowRate({ noShows: 3, totalBookings: 20 })).toBe(0.15);
  });

  it('devuelve null sin reservas', () => {
    expect(noShowRate({ noShows: 0, totalBookings: 0 })).toBeNull();
  });
});

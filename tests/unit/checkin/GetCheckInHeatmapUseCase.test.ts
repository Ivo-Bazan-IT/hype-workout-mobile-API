import { describe, it, expect, vi } from 'vitest';
import { GetCheckInHeatmapUseCase } from '../../../src/application/use-cases/checkin/GetCheckInHeatmapUseCase';
import { ZONA_HORARIA_DEFAULT } from '../../../src/domain/time/zonaHoraria';

/** Jueves 6 de agosto de 2026, 15:00 en Buenos Aires. */
const AHORA = new Date('2026-08-06T18:00:00.000Z');

function build(
  overrides: {
    timezone?: string;
    celdas?: unknown[];
    registroDesde?: Date | null;
  } = {}
) {
  const checkInRepository = {
    getHeatmap: vi.fn().mockResolvedValue(overrides.celdas ?? []),
  } as any;

  const gymRepository = {
    findById: vi.fn().mockResolvedValue({ id: 'gym-1', timezone: overrides.timezone }),
  } as any;

  const metricsRepository = {
    getFirstCheckInDate: vi.fn().mockResolvedValue(overrides.registroDesde ?? null),
  } as any;

  return {
    useCase: new GetCheckInHeatmapUseCase(
      checkInRepository,
      gymRepository,
      metricsRepository
    ),
    checkInRepository,
    gymRepository,
    metricsRepository,
  };
}

describe('GetCheckInHeatmapUseCase', () => {
  describe('zona horaria', () => {
    it('usa la del gym cuando está configurada', async () => {
      const { useCase, checkInRepository } = build({ timezone: 'America/Santiago' });

      const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 8 });

      expect(mapa.zonaHoraria).toBe('America/Santiago');
      // Y llega hasta la agregación, que es donde efectivamente decide la franja.
      expect(checkInRepository.getHeatmap).toHaveBeenCalledWith(
        'gym-1',
        expect.anything(),
        'America/Santiago'
      );
    });

    it('cae al default del dominio cuando el gym no la configuró', async () => {
      const { useCase, checkInRepository } = build({ timezone: undefined });

      const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 8 });

      expect(mapa.zonaHoraria).toBe(ZONA_HORARIA_DEFAULT);
      expect(checkInRepository.getHeatmap).toHaveBeenCalledWith(
        'gym-1',
        expect.anything(),
        ZONA_HORARIA_DEFAULT
      );
    });

    it('la devuelve siempre, para que el front pueda rotular el eje', async () => {
      const { useCase } = build();

      const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 8 });

      // Es lo que hace aceptable un default: el front nunca tiene que adivinar cuál
      // se usó.
      expect(mapa.zonaHoraria).toBeTruthy();
    });
  });

  describe('ventana', () => {
    it('cubre exactamente semanas × 7 días', async () => {
      const { useCase } = build({ timezone: 'America/Argentina/Buenos_Aires' });

      const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 8 });

      const dias = (mapa.hasta.getTime() - mapa.desde.getTime()) / 86_400_000;
      expect(dias).toBe(56);
    });

    it('cierra al final del día del gimnasio, para que hoy entre completo', async () => {
      const { useCase } = build({ timezone: 'America/Argentina/Buenos_Aires' });

      const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 8 });

      // Medianoche del 7 de agosto en Buenos Aires = 03:00 UTC del 7.
      expect(mapa.hasta.toISOString()).toBe('2026-08-07T03:00:00.000Z');
      expect(mapa.desde.toISOString()).toBe('2026-06-12T03:00:00.000Z');
    });

    it('arranca y termina en medianoches del gimnasio, no en múltiplos de 24hs desde ahora', async () => {
      const { useCase } = build({ timezone: 'America/Argentina/Buenos_Aires' });

      const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 4 });

      // Si la ventana arrancara "hace 28 días exactos" caería a las 15:00 y las
      // columnas mezclarían media franja de un día con media del otro.
      expect(mapa.desde.getUTCHours()).toBe(3);
      expect(mapa.hasta.getUTCHours()).toBe(3);
    });

    it('escala con las semanas pedidas', async () => {
      const { useCase } = build();

      const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 1 });

      const dias = (mapa.hasta.getTime() - mapa.desde.getTime()) / 86_400_000;
      expect(dias).toBe(7);
    });
  });

  describe('registroDesde', () => {
    it('lo devuelve para que el front distinga el cero real del sin dato', async () => {
      const registro = new Date('2026-03-01T12:00:00.000Z');
      const { useCase } = build({ registroDesde: registro });

      const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 8 });

      expect(mapa.registroDesde).toEqual(registro);
    });

    it('es null si el gym nunca registró una asistencia', async () => {
      const { useCase } = build({ registroDesde: null });

      const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 8 });

      expect(mapa.registroDesde).toBeNull();
      expect(mapa.celdas).toEqual([]);
    });
  });

  it('devuelve las celdas tal como las agregó la base, sin rellenar los ceros', async () => {
    const celdas = [
      { dia: 3, hora: 19, total: 42 },
      { dia: 3, hora: 20, total: 38 },
    ];
    const { useCase } = build({ celdas });

    const mapa = await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 8 });

    expect(mapa.celdas).toEqual(celdas);
  });

  it('consulta el gym del tenant', async () => {
    const { useCase, gymRepository } = build();

    await useCase.execute({ gymId: 'gym-1', now: AHORA, semanas: 8 });

    expect(gymRepository.findById).toHaveBeenCalledWith('gym-1');
  });
});

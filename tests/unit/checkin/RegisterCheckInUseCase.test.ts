import { describe, it, expect, vi } from 'vitest';
import { RegisterCheckInUseCase } from '../../../src/application/use-cases/checkin/RegisterCheckInUseCase';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const AHORA = new Date('2026-03-15T18:30:00.000Z');

function build(overrides: {
  client?: unknown;
  yaRegistrado?: unknown;
  /** `undefined` = el gym no configuró zona horaria y se cae al default. */
  timezone?: string;
} = {}) {
  const clientRepository = {
    findById: vi.fn().mockResolvedValue(
      'client' in overrides
        ? overrides.client
        : { id: 'client-1', gymId: 'gym-1', estado: 'activo' }
    ),
  } as any;

  const checkInRepository = {
    findByClientAndDay: vi.fn().mockResolvedValue(overrides.yaRegistrado ?? null),
    create: vi.fn().mockImplementation((c) => Promise.resolve({ id: 'checkin-1', ...c })),
  } as any;

  const gymRepository = {
    findById: vi.fn().mockResolvedValue({ id: 'gym-1', timezone: overrides.timezone }),
  } as any;

  return {
    useCase: new RegisterCheckInUseCase(checkInRepository, clientRepository, gymRepository),
    checkInRepository,
    clientRepository,
    gymRepository,
  };
}

describe('RegisterCheckInUseCase', () => {
  it('registra la asistencia del socio', async () => {
    const { useCase, checkInRepository } = build();

    const checkIn = await useCase.execute({
      gymId: 'gym-1',
      clientId: 'client-1',
      fecha: AHORA,
    });

    expect(checkInRepository.create).toHaveBeenCalledWith({
      gymId: 'gym-1',
      clientId: 'client-1',
      fecha: AHORA,
    });
    expect(checkIn.id).toBe('checkin-1');
  });

  it('busca el cliente dentro del gym del tenant', async () => {
    const { useCase, clientRepository } = build();

    await useCase.execute({ gymId: 'gym-1', clientId: 'client-1', fecha: AHORA });

    expect(clientRepository.findById).toHaveBeenCalledWith('client-1', 'gym-1');
  });

  it('rechaza un cliente que no existe en ese gym', async () => {
    const { useCase } = build({ client: null });

    await expect(
      useCase.execute({ gymId: 'gym-1', clientId: 'ajeno', fecha: AHORA })
    ).rejects.toThrow(NotFoundError);
  });

  it('rechaza al cliente eliminado', async () => {
    const { useCase } = build({
      client: { id: 'client-1', gymId: 'gym-1', estado: 'inactivo' },
    });

    await expect(
      useCase.execute({ gymId: 'gym-1', clientId: 'client-1', fecha: AHORA })
    ).rejects.toThrow(ValidationError);
  });

  it('registra igual al socio con la membresía vencida: entró, y ese dato vale', async () => {
    const { useCase, checkInRepository } = build({
      client: { id: 'client-1', gymId: 'gym-1', estado: 'pendiente' },
    });

    await useCase.execute({ gymId: 'gym-1', clientId: 'client-1', fecha: AHORA });

    expect(checkInRepository.create).toHaveBeenCalled();
  });

  it('es idempotente por día: dos escaneos son una visita', async () => {
    const existente = { id: 'checkin-previo', gymId: 'gym-1', clientId: 'client-1' };
    const { useCase, checkInRepository } = build({ yaRegistrado: existente });

    const resultado = await useCase.execute({
      gymId: 'gym-1',
      clientId: 'client-1',
      fecha: AHORA,
    });

    expect(resultado).toBe(existente);
    expect(checkInRepository.create).not.toHaveBeenCalled();
  });

  /**
   * El día que decide la idempotencia es el del gimnasio, no el del proceso Node.
   *
   * `AHORA` son las 18:30 UTC, o sea las 15:30 en Buenos Aires: mismo día en las dos
   * zonas. Lo que cambia el borde es el instante de las 00:30 UTC, que en Argentina
   * todavía es la noche anterior — ahí es donde el corte tiene que diferir.
   */
  describe('corte del día en la zona del gimnasio', () => {
    /** Las 21:30 del 9 de marzo en Buenos Aires son las 00:30 del 10 en UTC. */
    const NOCHE = new Date('2026-03-10T00:30:00.000Z');

    it('recorta el día con la zona horaria configurada del gym', async () => {
      const { useCase, checkInRepository } = build({
        timezone: 'America/Argentina/Buenos_Aires',
      });

      await useCase.execute({ gymId: 'gym-1', clientId: 'client-1', fecha: NOCHE });

      const [, , dia] = checkInRepository.findByClientAndDay.mock.calls[0];

      // El día del gimnasio arranca a las 00:00 argentinas del 9, que son las 03:00
      // UTC del 9 — no la medianoche UTC del 10.
      expect(dia.start.toISOString()).toBe('2026-03-09T03:00:00.000Z');
      expect(dia.end.toISOString()).toBe('2026-03-10T03:00:00.000Z');
    });

    it('cae al default cuando el gym no configuró zona horaria', async () => {
      const { useCase, checkInRepository } = build({ timezone: undefined });

      await useCase.execute({ gymId: 'gym-1', clientId: 'client-1', fecha: NOCHE });

      const [, , dia] = checkInRepository.findByClientAndDay.mock.calls[0];

      expect(dia.start.toISOString()).toBe('2026-03-09T03:00:00.000Z');
    });

    it('respeta una zona distinta de la del default', async () => {
      const { useCase, checkInRepository } = build({ timezone: 'UTC' });

      await useCase.execute({ gymId: 'gym-1', clientId: 'client-1', fecha: NOCHE });

      const [, , dia] = checkInRepository.findByClientAndDay.mock.calls[0];

      // Con el gym en UTC, ese mismo instante ya es del día 10.
      expect(dia.start.toISOString()).toBe('2026-03-10T00:00:00.000Z');
    });

    it('busca la zona del gym del tenant', async () => {
      const { useCase, gymRepository } = build();

      await useCase.execute({ gymId: 'gym-1', clientId: 'client-1', fecha: AHORA });

      expect(gymRepository.findById).toHaveBeenCalledWith('gym-1');
    });
  });
});

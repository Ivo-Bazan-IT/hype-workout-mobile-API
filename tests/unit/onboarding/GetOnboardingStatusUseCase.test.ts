import { describe, it, expect, vi } from 'vitest';
import { GetOnboardingStatusUseCase } from '../../../src/application/use-cases/onboarding/GetOnboardingStatusUseCase';
import { NotFoundError } from '../../../src/shared/errors/AppError';

const statsVacias = {
  total: 0,
  procesadas: 0,
  rechazadas: 0,
  ultima: null,
  ultimosRechazos: [],
};

function makeUseCase(input: {
  gym?: Record<string, unknown> | null;
  stats?: Record<string, unknown>;
} = {}) {
  const gymRepository = {
    findById: vi
      .fn()
      .mockResolvedValue(input.gym === undefined ? { id: 'gym-1' } : input.gym),
  } as any;

  const submissionRecordRepository = {
    getStats: vi.fn().mockResolvedValue(input.stats ?? statsVacias),
  } as any;

  return {
    useCase: new GetOnboardingStatusUseCase(gymRepository, submissionRecordRepository),
    submissionRecordRepository,
  };
}

describe('GetOnboardingStatusUseCase', () => {
  it('informa que no está configurado cuando el gym no generó su secreto', async () => {
    const { useCase } = makeUseCase({ gym: { id: 'gym-1', googleFormConfig: {} } });

    const estado = await useCase.execute({ gymId: 'gym-1' });

    expect(estado.configurado).toBe(false);
    expect(estado.fieldMapping).toBeNull();
  });

  it('no devuelve el hash del secreto, solo si existe', async () => {
    const { useCase } = makeUseCase({
      gym: { id: 'gym-1', googleFormConfig: { webhookSecretHash: '$2b$10$loquesea' } },
    });

    const estado = await useCase.execute({ gymId: 'gym-1' });

    expect(estado.configurado).toBe(true);
    expect(JSON.stringify(estado)).not.toContain('$2b$10$');
  });

  it('devuelve null en la última recepción cuando nunca llegó una submission', async () => {
    const { useCase } = makeUseCase();

    const estado = await useCase.execute({ gymId: 'gym-1' });

    // El stub anterior devolvía `lastSync: new Date()`, o sea "recién sincronizado"
    // incluso con el trigger desinstalado hace meses.
    expect(estado.submissions.ultimaRecibidaEn).toBeNull();
    expect(estado.submissions.ultimoResultado).toBeNull();
    expect(estado.submissions.total).toBe(0);
  });

  it('resume las submissions recibidas y lista los rechazos', async () => {
    const { useCase } = makeUseCase({
      stats: {
        total: 12,
        procesadas: 10,
        rechazadas: 2,
        ultima: {
          resultado: 'procesada',
          recibidaEn: new Date('2026-08-07T18:00:00.000Z'),
        },
        ultimosRechazos: [
          {
            documento: '99999999',
            motivo: 'Client with documento 99999999 not found',
            recibidaEn: new Date('2026-08-06T12:00:00.000Z'),
          },
        ],
      },
    });

    const estado = await useCase.execute({ gymId: 'gym-1' });

    expect(estado.submissions).toEqual({
      total: 12,
      procesadas: 10,
      rechazadas: 2,
      ultimaRecibidaEn: new Date('2026-08-07T18:00:00.000Z'),
      ultimoResultado: 'procesada',
    });
    // El DNI que rebotó es el dato accionable: casi siempre es un tipeo o un socio
    // que todavía no se cargó.
    expect(estado.ultimosRechazos[0].documento).toBe('99999999');
  });

  it('devuelve el mapeo declarado por el gym', async () => {
    const { useCase } = makeUseCase({
      gym: {
        id: 'gym-1',
        googleFormConfig: { fieldMapping: { documento: 'DNI', objetivo: 'Objetivos' } },
      },
    });

    const estado = await useCase.execute({ gymId: 'gym-1' });

    expect(estado.fieldMapping).toEqual({ documento: 'DNI', objetivo: 'Objetivos' });
  });

  it('pide las estadísticas del gym del tenant y de ningún otro', async () => {
    const { useCase, submissionRecordRepository } = makeUseCase();

    await useCase.execute({ gymId: 'gym-1' });

    expect(submissionRecordRepository.getStats).toHaveBeenCalledWith('gym-1', 10);
  });

  it('lanza NotFoundError si el gym no existe', async () => {
    const { useCase } = makeUseCase({ gym: null });

    await expect(useCase.execute({ gymId: 'missing' })).rejects.toThrow(NotFoundError);
  });
});

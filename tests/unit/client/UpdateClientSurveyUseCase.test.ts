import { describe, it, expect, vi } from 'vitest';
import { UpdateClientSurveyUseCase } from '../../../src/application/use-cases/client/UpdateClientSurveyUseCase';

describe('UpdateClientSurveyUseCase', () => {
  it('fusiona las respuestas nuevas sobre las ya cargadas', async () => {
    const existingClient = {
      id: 'client-1',
      gymId: 'gym-1',
      nombre: 'Iván Bazán',
      documento: '40123456',
      encuestaData: { objetivo: 'Bajar de peso', lesiones: 'Ninguna' },
    };

    const mockClientRepo = {
      findById: vi.fn().mockResolvedValue(existingClient),
      update: vi.fn().mockImplementation((_id, _gymId, data) =>
        Promise.resolve({ ...existingClient, ...data })
      ),
    } as any;

    const useCase = new UpdateClientSurveyUseCase(mockClientRepo);

    await useCase.execute({
      clientId: 'client-1',
      gymId: 'gym-1',
      encuestaData: { objetivo: 'Ganar masa muscular', entrenamientos_por_semana: 4 },
    });

    expect(mockClientRepo.update).toHaveBeenCalledWith('client-1', 'gym-1', {
      encuestaData: {
        lesiones: 'Ninguna', // se conserva: la tanda nueva no lo trae
        objetivo: 'Ganar masa muscular', // se pisa
        entrenamientos_por_semana: 4, // se agrega
      },
    });
  });

  it('promueve el teléfono de la encuesta a campo propio del cliente', async () => {
    const mockClientRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'client-1', gymId: 'gym-1' }),
      update: vi.fn().mockResolvedValue({ id: 'client-1', telefono: '5491122334455' }),
    } as any;

    const useCase = new UpdateClientSurveyUseCase(mockClientRepo);

    await useCase.execute({
      clientId: 'client-1',
      gymId: 'gym-1',
      telefono: '5491122334455',
      encuestaData: { objetivo: 'Fuerza' },
    });

    expect(mockClientRepo.update).toHaveBeenCalledWith('client-1', 'gym-1', {
      telefono: '5491122334455',
      encuestaData: { objetivo: 'Fuerza' },
    });
  });

  it('funciona sobre un cliente que todavía no tiene encuesta', async () => {
    const mockClientRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'client-1', gymId: 'gym-1' }),
      update: vi.fn().mockResolvedValue({ id: 'client-1' }),
    } as any;

    const useCase = new UpdateClientSurveyUseCase(mockClientRepo);

    await useCase.execute({
      clientId: 'client-1',
      gymId: 'gym-1',
      encuestaData: { objetivo: 'Resistencia' },
    });

    expect(mockClientRepo.update).toHaveBeenCalledWith('client-1', 'gym-1', {
      encuestaData: { objetivo: 'Resistencia' },
    });
  });

  it('respeta el aislamiento por gym y lanza NotFoundError', async () => {
    const mockClientRepo = {
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    } as any;

    const useCase = new UpdateClientSurveyUseCase(mockClientRepo);

    await expect(
      useCase.execute({ clientId: 'client-1', gymId: 'otro-gym', encuestaData: { a: 1 } })
    ).rejects.toThrow('Client not found');

    expect(mockClientRepo.findById).toHaveBeenCalledWith('client-1', 'otro-gym');
    expect(mockClientRepo.update).not.toHaveBeenCalled();
  });
});

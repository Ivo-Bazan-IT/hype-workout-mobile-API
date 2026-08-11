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
      // El cliente no tenía encuesta: esta es su conversión (ver el bloque de abajo).
      fechaConversion: expect.any(Date),
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
      fechaConversion: expect.any(Date),
      encuestaData: { objetivo: 'Resistencia' },
    });
  });

  describe('sello de conversión', () => {
    const makeUseCase = (existingClient: Record<string, unknown>) => {
      const mockClientRepo = {
        findById: vi.fn().mockResolvedValue(existingClient),
        update: vi.fn().mockImplementation((_id, _gymId, data) =>
          Promise.resolve({ ...existingClient, ...data })
        ),
      } as any;

      return { useCase: new UpdateClientSurveyUseCase(mockClientRepo), mockClientRepo };
    };

    it('sella la conversión cuando el lead contesta por primera vez', async () => {
      const { useCase, mockClientRepo } = makeUseCase({ id: 'client-1', gymId: 'gym-1' });

      const antes = Date.now();
      await useCase.execute({
        clientId: 'client-1',
        gymId: 'gym-1',
        encuestaData: { objetivo: 'Fuerza' },
      });

      const [, , data] = mockClientRepo.update.mock.calls[0];
      expect(data.fechaConversion.getTime()).toBeGreaterThanOrEqual(antes);
    });

    it('no re-sella al completar la ficha en una segunda tanda', async () => {
      const { useCase, mockClientRepo } = makeUseCase({
        id: 'client-1',
        gymId: 'gym-1',
        encuestaData: { objetivo: 'Fuerza' },
        fechaConversion: new Date('2026-01-10T00:00:00.000Z'),
      });

      await useCase.execute({
        clientId: 'client-1',
        gymId: 'gym-1',
        encuestaData: { lesiones: 'Rodilla' },
      });

      // Correr la fecha acá imputaría al mes en curso una conversión de enero.
      const [, , data] = mockClientRepo.update.mock.calls[0];
      expect(data.fechaConversion).toBeUndefined();
    });

    it('no le inventa fecha al que convirtió antes de que el campo existiera', async () => {
      const { useCase, mockClientRepo } = makeUseCase({
        id: 'client-1',
        gymId: 'gym-1',
        // Tiene encuesta pero no `fechaConversion`: es anterior a la tanda 4.
        encuestaData: { objetivo: 'Fuerza' },
      });

      await useCase.execute({
        clientId: 'client-1',
        gymId: 'gym-1',
        encuestaData: { lesiones: 'Ninguna' },
      });

      const [, , data] = mockClientRepo.update.mock.calls[0];
      expect(data.fechaConversion).toBeUndefined();
    });

    it('no cuenta como conversión una encuesta vacía', async () => {
      const { useCase, mockClientRepo } = makeUseCase({
        id: 'client-1',
        gymId: 'gym-1',
        encuestaData: {},
      });

      await useCase.execute({
        clientId: 'client-1',
        gymId: 'gym-1',
        encuestaData: { objetivo: 'Fuerza' },
      });

      // El `{}` previo no era una encuesta contestada, así que esta SÍ es la conversión.
      const [, , data] = mockClientRepo.update.mock.calls[0];
      expect(data.fechaConversion).toBeInstanceOf(Date);
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

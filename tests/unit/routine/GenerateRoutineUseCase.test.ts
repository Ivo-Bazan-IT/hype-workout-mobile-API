import { describe, it, expect, vi } from 'vitest';
import { GenerateRoutineUseCase } from '../../../src/application/use-cases/routine/GenerateRoutineUseCase';

const encuestaData = {
  '¿Cuál es tu objetivo?': ['Ganar masa muscular'],
  '¿Cuántos días podés entrenar?': '4',
};

const gym = {
  id: 'gym-1',
  aiConfig: { provider: 'openai', promptTemplate: '{{respuestas_encuesta}}' },
  whatsappConfig: { phoneNumberId: 'phone-1' },
};

const buildMocks = (clientOverrides: Record<string, any> = {}) => {
  const generateRoutine = vi.fn().mockResolvedValue({ contenidoGenerado: '## Rutina' });

  return {
    generateRoutine,
    routineRepository: {
      create: vi.fn().mockResolvedValue({ id: 'routine-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
    } as any,
    clientRepository: {
      findById: vi.fn().mockResolvedValue({
        id: 'client-1',
        gymId: 'gym-1',
        nombre: 'Iván Bazán',
        telefono: '5491122334455',
        fechaVencimiento: new Date('2026-08-01'),
        encuestaData,
        ...clientOverrides,
      }),
    } as any,
    gymRepository: { findById: vi.fn().mockResolvedValue(gym) } as any,
    gymSecretsRepo: {
      getAiApiKey: vi.fn().mockResolvedValue('sk-test'),
      // null => se saltea el envío por WhatsApp
      getWhatsappAccessToken: vi.fn().mockResolvedValue(null),
    } as any,
    aiProviderFactory: { create: vi.fn().mockReturnValue({ generateRoutine }) } as any,
    pdfGenerator: {
      generateFromHtml: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    } as any,
    whatsappProviderFactory: { create: vi.fn() } as any,
    fileStorage: {
      save: vi.fn().mockResolvedValue({ url: 'storage/generated/routine-1.pdf' }),
      read: vi.fn(),
    } as any,
  };
};

const buildUseCase = (m: ReturnType<typeof buildMocks>) =>
  new GenerateRoutineUseCase(
    m.routineRepository,
    m.clientRepository,
    m.gymRepository,
    m.gymSecretsRepo,
    m.aiProviderFactory,
    m.pdfGenerator,
    m.whatsappProviderFactory,
    m.fileStorage
  );

describe('GenerateRoutineUseCase', () => {
  it('pasa las respuestas de la encuesta al proveedor de IA', async () => {
    const mocks = buildMocks();
    const useCase = buildUseCase(mocks);

    const result = await useCase.execute('client-1', 'gym-1');

    expect(mocks.clientRepository.findById).toHaveBeenCalledWith('client-1', 'gym-1');
    expect(mocks.generateRoutine).toHaveBeenCalledWith({
      promptTemplate: '{{respuestas_encuesta}}',
      encuestaData,
    });
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'enviado'
    );
    expect(result.routineId).toBe('routine-1');
  });

  it('rechaza al cliente sin encuestaData', async () => {
    const mocks = buildMocks({ encuestaData: undefined });
    const useCase = buildUseCase(mocks);

    await expect(useCase.execute('client-1', 'gym-1')).rejects.toThrow(
      'Client has no survey data. Complete the onboarding form first.'
    );
    expect(mocks.routineRepository.create).not.toHaveBeenCalled();
  });

  it('rechaza al cliente con encuestaData vacía', async () => {
    const mocks = buildMocks({ encuestaData: {} });
    const useCase = buildUseCase(mocks);

    await expect(useCase.execute('client-1', 'gym-1')).rejects.toThrow(
      'Client has no survey data. Complete the onboarding form first.'
    );
    expect(mocks.routineRepository.create).not.toHaveBeenCalled();
  });

  it('marca la rutina en error si falla la generación con IA', async () => {
    const mocks = buildMocks();
    mocks.generateRoutine.mockRejectedValue(new Error('AI provider down'));
    const useCase = buildUseCase(mocks);

    await expect(useCase.execute('client-1', 'gym-1')).rejects.toThrow('AI provider down');
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'error'
    );
  });
});

import { describe, it, expect, vi } from 'vitest';
import { GenerateRoutineUseCase } from '../../../src/application/use-cases/routine/GenerateRoutineUseCase';

const encuestaData = {
  '¿Cuál es tu objetivo?': ['Ganar masa muscular'],
  '¿Cuántos días podés entrenar?': '4',
};

const gym = {
  id: 'gym-1',
  name: 'Hype Workout',
  aiConfig: {
    provider: 'openai',
    promptTemplate:
      'Sos el entrenador de {{gym_nombre}}. Cliente: {{cliente_nombre}}. Encuesta: {{respuestas_encuesta}}',
    model: 'gpt-4o',
  },
  whatsappConfig: { phoneNumberId: 'phone-1' },
};

const buildMocks = (clientOverrides: Record<string, any> = {}) => {
  const generateRoutine = vi.fn().mockResolvedValue({
    contenidoGenerado: '## Rutina',
    usage: {
      model: 'gpt-4o',
      tokensPrompt: 1000,
      tokensRespuesta: 2000,
      tokensTotal: 3000,
    },
  });

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
    aiUsageRepository: {
      create: vi.fn().mockResolvedValue({ id: 'usage-1' }),
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
    m.fileStorage,
    m.aiUsageRepository
  );

describe('GenerateRoutineUseCase', () => {
  it('renderiza el prompt del gym con los datos del cliente y lo manda a la IA', async () => {
    const mocks = buildMocks();
    const useCase = buildUseCase(mocks);

    const result = await useCase.execute('client-1', 'gym-1');

    expect(mocks.clientRepository.findById).toHaveBeenCalledWith('client-1', 'gym-1');

    // El adaptador recibe el prompt YA renderizado, no el template
    const { prompt, model } = mocks.generateRoutine.mock.calls[0][0];
    expect(prompt).toContain('Sos el entrenador de Hype Workout');
    expect(prompt).toContain('Cliente: Iván Bazán');
    expect(prompt).toContain('"¿Cuál es tu objetivo?"');
    expect(prompt).not.toContain('{{');
    // El modelo configurado por el gym se respeta
    expect(model).toBe('gpt-4o');

    // Se persiste el prompt renderizado, para poder auditar la rutina después
    expect(mocks.routineRepository.update).toHaveBeenCalledWith(
      'routine-1',
      'gym-1',
      expect.objectContaining({ promptUsado: prompt })
    );
    // Sin token de WhatsApp el envío se saltea, así que el estado de envío queda
    // 'pendiente'. Marcarlo 'enviado' dejaba rutinas que nadie recibió figurando
    // como entregadas, sin forma de detectarlas para reenviarlas.
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'pendiente'
    );
    expect(mocks.whatsappProviderFactory.create).not.toHaveBeenCalled();
    expect(result.routineId).toBe('routine-1');
  });

  it('envía el PDF con las credenciales de WhatsApp del propio gym', async () => {
    const mocks = buildMocks();
    const sendPdfDocument = vi.fn().mockResolvedValue({ messageId: 'wamid-1' });

    mocks.gymSecretsRepo.getWhatsappAccessToken.mockResolvedValue('gym-1-token');
    mocks.whatsappProviderFactory.create.mockReturnValue({ sendPdfDocument });

    const useCase = buildUseCase(mocks);
    await useCase.execute('client-1', 'gym-1');

    // El token se resuelve POR gym, no de una variable global compartida
    expect(mocks.gymSecretsRepo.getWhatsappAccessToken).toHaveBeenCalledWith('gym-1');
    expect(mocks.whatsappProviderFactory.create).toHaveBeenCalledWith({
      phoneNumberId: 'phone-1',
      accessToken: 'gym-1-token',
    });
    expect(sendPdfDocument).toHaveBeenCalledWith(
      expect.objectContaining({ to: '5491122334455' })
    );
    expect(mocks.routineRepository.update).toHaveBeenCalledWith(
      'routine-1',
      'gym-1',
      { whatsappMessageId: 'wamid-1' }
    );
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'enviado'
    );
  });

  it('no envía ni marca enviado si el gym no configuró su número de WhatsApp', async () => {
    const mocks = buildMocks();
    mocks.gymSecretsRepo.getWhatsappAccessToken.mockResolvedValue('gym-1-token');
    mocks.gymRepository.findById.mockResolvedValue({
      ...gym,
      whatsappConfig: { phoneNumberId: '' },
    });

    const useCase = buildUseCase(mocks);
    await useCase.execute('client-1', 'gym-1');

    expect(mocks.whatsappProviderFactory.create).not.toHaveBeenCalled();
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'pendiente'
    );
  });

  it('registra el consumo de IA atribuido al gym, con costo estimado', async () => {
    const mocks = buildMocks();
    const useCase = buildUseCase(mocks);

    await useCase.execute('client-1', 'gym-1');

    expect(mocks.aiUsageRepository.create).toHaveBeenCalledWith({
      gymId: 'gym-1',
      clientId: 'client-1',
      routineId: 'routine-1',
      provider: 'openai',
      model: 'gpt-4o',
      tokensPrompt: 1000,
      tokensRespuesta: 2000,
      tokensTotal: 3000,
      // gpt-4o: 1000/1M * 2.5 + 2000/1M * 10 = 0.0025 + 0.02
      costoEstimado: 0.0225,
    });
  });

  it('deja el costo en null si el modelo no tiene precio cargado', async () => {
    const mocks = buildMocks();
    mocks.generateRoutine.mockResolvedValue({
      contenidoGenerado: '## Rutina',
      usage: {
        model: 'modelo-inexistente',
        tokensPrompt: 100,
        tokensRespuesta: 200,
        tokensTotal: 300,
      },
    });
    const useCase = buildUseCase(mocks);

    await useCase.execute('client-1', 'gym-1');

    // null y no 0: "no sé cuánto costó" no es lo mismo que "salió gratis"
    const [registro] = mocks.aiUsageRepository.create.mock.calls[0];
    expect(registro.costoEstimado).toBeNull();
    expect(registro.tokensTotal).toBe(300);
  });

  it('no rompe la generación si falla el registro del consumo', async () => {
    const mocks = buildMocks();
    mocks.aiUsageRepository.create.mockRejectedValue(new Error('mongo caído'));
    const useCase = buildUseCase(mocks);

    // La rutina ya se generó y el proveedor ya cobró: perderla por un fallo de
    // medición sería mucho peor que perder el registro.
    const result = await useCase.execute('client-1', 'gym-1');

    expect(result.routineId).toBe('routine-1');
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'pendiente'
    );
  });

  it('no registra consumo si el proveedor no informa usage', async () => {
    const mocks = buildMocks();
    mocks.generateRoutine.mockResolvedValue({ contenidoGenerado: '## Rutina' });
    const useCase = buildUseCase(mocks);

    await useCase.execute('client-1', 'gym-1');

    // Mejor no registrar nada que anotar ceros que se leerían como consumo real
    expect(mocks.aiUsageRepository.create).not.toHaveBeenCalled();
  });

  it('rechaza con 400 accionable si el gym no tiene API key de IA', async () => {
    const mocks = buildMocks();
    mocks.gymSecretsRepo.getAiApiKey.mockResolvedValue(null);
    const useCase = buildUseCase(mocks);

    await expect(useCase.execute('client-1', 'gym-1')).rejects.toThrow(
      'No AI API key configured for provider "openai"'
    );

    // La rutina queda marcada en error, no colgada en 'generando'
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'error'
    );
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

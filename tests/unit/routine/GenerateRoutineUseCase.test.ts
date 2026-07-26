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
        // Construida en hora LOCAL a propósito: `new Date('2026-08-01')` es
        // medianoche UTC y en Argentina (UTC-3) se formatea como 31/07, así que
        // la aserción del PDF dependería de la zona horaria de quien corra el test
        fechaVencimiento: new Date(2026, 7, 1),
        encuestaData,
        ...clientOverrides,
      }),
    } as any,
    gymRepository: { findById: vi.fn().mockResolvedValue(gym) } as any,
    gymSecretsRepo: {
      resolveAiCredentials: vi.fn().mockResolvedValue({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o',
        fuente: 'gym',
      }),
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
    plantillaProvider: {
      obtenerStandard: vi.fn().mockResolvedValue({
        htmlTemplate: '<h1>{{clienteNombre}}</h1>{{rutina}}',
        fondo: Buffer.from('%PDF-standard'),
        fuente: 'standard',
      }),
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
    m.aiUsageRepository,
    m.plantillaProvider
  );

const useCaseConMocks = (m: ReturnType<typeof buildMocks>) =>
  buildUseCase(m).execute('client-1', 'gym-1');

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

  it('no pierde la rutina si falla el envío por WhatsApp', async () => {
    const mocks = buildMocks();
    mocks.gymSecretsRepo.getWhatsappAccessToken.mockResolvedValue('gym-1-token');
    mocks.whatsappProviderFactory.create.mockReturnValue({
      sendPdfDocument: vi.fn().mockRejectedValue(new Error('Meta devolvió 400')),
    });

    // La rutina ya se generó y el modelo ya se cobró: tirar todo abajo porque Meta
    // falló obligaría al gym a pagar otra generación para recuperarla
    const result = await useCaseConMocks(mocks);

    expect(result.routineId).toBe('routine-1');
    // 'generado' con envío en 'error': queda reintentable con POST /:id/resend
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'error'
    );
  });

  it('distingue "no se pudo intentar" de "se intentó y falló"', async () => {
    // Sin token no se llega ni a llamar a Meta: es configuración faltante, no un
    // fallo de envío. Se resuelve completando la config, no reintentando.
    const mocks = buildMocks();
    await useCaseConMocks(mocks);

    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'pendiente'
    );
  });

  it('no pierde la rutina si el token de WhatsApp no se puede descifrar', async () => {
    const mocks = buildMocks();
    mocks.gymSecretsRepo.getWhatsappAccessToken.mockRejectedValue(
      new Error('could not be decrypted')
    );

    const result = await useCaseConMocks(mocks);

    expect(result.routineId).toBe('routine-1');
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'error'
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

  it('genera el PDF con la plantilla standard estampada sobre su fondo', async () => {
    const mocks = buildMocks();
    const useCase = buildUseCase(mocks);

    await useCase.execute('client-1', 'gym-1');

    const [params] = mocks.pdfGenerator.generateFromHtml.mock.calls[0];
    expect(params.template.htmlTemplate).toBe('<h1>{{clienteNombre}}</h1>{{rutina}}');
    // El fondo viaja al generador: sin esto el arte del PDF se pierde
    expect(params.fondo).toEqual(Buffer.from('%PDF-standard'));
    // Fecha en formato es-AR, que es quien lee el PDF
    expect(params.data.fechaVencimiento).toBe('01/08/2026');
    expect(params.data.gymNombre).toBe('Hype Workout');
  });

  it('prefiere la plantilla propia del gym si cargó una', async () => {
    const mocks = buildMocks();
    mocks.gymRepository.findById.mockResolvedValue({
      ...gym,
      pdfTemplate: { htmlTemplate: '<article>propia {{rutina}}</article>' },
    });
    const useCase = buildUseCase(mocks);

    await useCase.execute('client-1', 'gym-1');

    const [params] = mocks.pdfGenerator.generateFromHtml.mock.calls[0];
    expect(params.template.htmlTemplate).toBe('<article>propia {{rutina}}</article>');
    // Sigue sobre el fondo standard: la subida de fondo propio no está implementada
    expect(params.fondo).toEqual(Buffer.from('%PDF-standard'));
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
      fuenteCredencial: 'gym',
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

  it('le pide la credencial al resolver con el proveedor y modelo del gym', async () => {
    const mocks = buildMocks();
    const useCase = buildUseCase(mocks);

    await useCase.execute('client-1', 'gym-1');

    expect(mocks.gymSecretsRepo.resolveAiCredentials).toHaveBeenCalledWith(
      'gym-1',
      'openai',
      'gpt-4o'
    );
    // Y usa lo que el resolver devolvió, no lo que dice aiConfig
    expect(mocks.aiProviderFactory.create).toHaveBeenCalledWith('openai', 'sk-test');
  });

  it('genera con el proveedor de respaldo cuando el gym no tiene key propia', async () => {
    const mocks = buildMocks();
    mocks.gymSecretsRepo.resolveAiCredentials.mockResolvedValue({
      provider: 'deepseek',
      apiKey: 'sk-plataforma',
      model: undefined,
      fuente: 'respaldo',
    });
    const useCase = buildUseCase(mocks);

    const result = await useCase.execute('client-1', 'gym-1');

    // La rutina se genera igual: perder la funcionalidad era el problema a resolver
    expect(mocks.aiProviderFactory.create).toHaveBeenCalledWith('deepseek', 'sk-plataforma');
    // Sin modelo: `gpt-4o` (el del gym) contra DeepSeek falla
    expect(mocks.generateRoutine.mock.calls[0][0].model).toBeUndefined();
    expect(result.routineId).toBe('routine-1');
    // La degradación viaja al caller para que el dueño pueda enterarse
    expect(result.fuenteCredencial).toBe('respaldo');
  });

  it('atribuye el consumo al proveedor realmente usado, no al configurado', async () => {
    const mocks = buildMocks();
    mocks.gymSecretsRepo.resolveAiCredentials.mockResolvedValue({
      provider: 'deepseek',
      apiKey: 'sk-plataforma',
      model: undefined,
      fuente: 'respaldo',
    });
    mocks.generateRoutine.mockResolvedValue({
      contenidoGenerado: '## Rutina',
      usage: {
        model: 'deepseek-chat',
        tokensPrompt: 1000,
        tokensRespuesta: 2000,
        tokensTotal: 3000,
      },
    });
    const useCase = buildUseCase(mocks);

    await useCase.execute('client-1', 'gym-1');

    const [registro] = mocks.aiUsageRepository.create.mock.calls[0];
    // El gym tiene aiConfig.provider = 'openai', pero generó DeepSeek: cargarle los
    // tokens a OpenAI sumaría consumo a una cuenta que nunca se llamó
    expect(registro.provider).toBe('deepseek');
    expect(registro.model).toBe('deepseek-chat');
    // Y queda registrado que lo pagó la plataforma, no el gym
    expect(registro.fuenteCredencial).toBe('respaldo');
    // deepseek-chat: 1000/1M * 0.27 + 2000/1M * 1.1 = 0.00027 + 0.0022
    expect(registro.costoEstimado).toBe(0.00247);
  });

  it('rechaza con 400 accionable si no hay ninguna credencial utilizable', async () => {
    const mocks = buildMocks();
    mocks.gymSecretsRepo.resolveAiCredentials.mockResolvedValue(null);
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

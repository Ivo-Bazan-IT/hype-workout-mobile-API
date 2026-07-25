import { describe, it, expect, vi } from 'vitest';
import { UpdateAiConfigUseCase } from '../../../src/application/use-cases/gym/UpdateAiConfigUseCase';

const gym = {
  id: 'gym-1',
  aiConfig: {
    provider: 'anthropic',
    promptTemplate: 'prompt viejo {{respuestas_encuesta}}',
    model: 'claude-sonnet-5',
  },
};

// El mock ofusca de verdad (base64): si devolviera `enc(<plano>)` el ciphertext
// contendría el texto plano y la aserción de "no se guarda en claro" sería inútil.
const cipher = (plain: string) => `cipher::${Buffer.from(plain).toString('base64')}`;

const buildEncryption = () =>
  ({
    encrypt: vi.fn(cipher),
    decrypt: vi.fn((payload: string) => payload),
  }) as any;

describe('UpdateAiConfigUseCase', () => {
  it('conserva provider y model al cambiar solo el promptTemplate', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(gym),
      update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ ...gym, ...data })),
    } as any;

    const useCase = new UpdateAiConfigUseCase(mockGymRepo, buildEncryption());

    const result = await useCase.execute({
      gymId: 'gym-1',
      promptTemplate: 'prompt nuevo {{respuestas_encuesta}}',
    });

    // El bug original reemplazaba el objeto entero y dejaba aiConfig sin provider,
    // rompiendo la selección de adaptador de IA en GenerateRoutineUseCase.
    expect(mockGymRepo.update).toHaveBeenCalledWith('gym-1', {
      aiConfig: {
        provider: 'anthropic',
        promptTemplate: 'prompt nuevo {{respuestas_encuesta}}',
        model: 'claude-sonnet-5',
      },
    });
    expect(result.aiConfig.provider).toBe('anthropic');
  });

  it('permite cambiar el provider conservando el prompt', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(gym),
      update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ ...gym, ...data })),
    } as any;

    const useCase = new UpdateAiConfigUseCase(mockGymRepo, buildEncryption());

    await useCase.execute({ gymId: 'gym-1', provider: 'openai' });

    expect(mockGymRepo.update).toHaveBeenCalledWith('gym-1', {
      aiConfig: {
        provider: 'openai',
        promptTemplate: 'prompt viejo {{respuestas_encuesta}}',
        model: 'claude-sonnet-5',
      },
    });
  });

  it('rechaza un prompt sin placeholders antes de tocar la base', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(gym),
      update: vi.fn(),
    } as any;

    const useCase = new UpdateAiConfigUseCase(mockGymRepo, buildEncryption());

    await expect(
      useCase.execute({
        gymId: 'gym-1',
        promptTemplate: 'Generá una rutina de musculación de 4 días.',
      })
    ).rejects.toThrow('must include at least one placeholder');

    expect(mockGymRepo.update).not.toHaveBeenCalled();
    expect(mockGymRepo.findById).not.toHaveBeenCalled();
  });

  it('rechaza un prompt con un placeholder mal escrito', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(gym),
      update: vi.fn(),
    } as any;

    const useCase = new UpdateAiConfigUseCase(mockGymRepo, buildEncryption());

    await expect(
      useCase.execute({
        gymId: 'gym-1',
        promptTemplate: 'Rutina para {{respuestas_encuesta}} con {{maquinaria_disponible}}',
      })
    ).rejects.toThrow('Unknown placeholders');

    expect(mockGymRepo.update).not.toHaveBeenCalled();
  });

  it('acepta un prompt con equipamiento del gym y placeholders válidos', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(gym),
      update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ ...gym, ...data })),
    } as any;

    const useCase = new UpdateAiConfigUseCase(mockGymRepo, buildEncryption());

    const promptTemplate =
      'Sos el entrenador de {{gym_nombre}}. EQUIPAMIENTO: 4 racks, 2 prensas 45°, poleas, ' +
      'mancuernas 2-40kg. NO tenemos piscina ni remo. Cliente {{cliente_nombre}}: {{respuestas_encuesta}}';

    const result = await useCase.execute({ gymId: 'gym-1', promptTemplate });

    expect(result.aiConfig.promptTemplate).toBe(promptTemplate);
    // Sigue conservando provider y model
    expect(result.aiConfig.provider).toBe('anthropic');
  });

  it('cifra la API key del gym antes de persistirla y no la guarda en claro', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(gym),
      update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ ...gym, ...data })),
    } as any;
    const encryption = buildEncryption();

    const useCase = new UpdateAiConfigUseCase(mockGymRepo, encryption);

    await useCase.execute({ gymId: 'gym-1', apiKey: 'sk-del-gym' });

    expect(encryption.encrypt).toHaveBeenCalledWith('sk-del-gym');

    const [, data] = mockGymRepo.update.mock.calls[0];
    expect(data.aiConfig.encryptedApiKey).toBe(cipher('sk-del-gym'));
    // La key en claro no queda en ningún campo persistido
    expect(JSON.stringify(data)).not.toContain('sk-del-gym');
    // Y el resto de la config sobrevive al merge
    expect(data.aiConfig.provider).toBe('anthropic');
    expect(data.aiConfig.promptTemplate).toBe('prompt viejo {{respuestas_encuesta}}');
  });

  it('no toca la API key guardada si no se envía una nueva', async () => {
    const gymConKey = {
      ...gym,
      aiConfig: { ...gym.aiConfig, encryptedApiKey: 'enc(anterior)' },
    };
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(gymConKey),
      update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ ...gymConKey, ...data })),
    } as any;
    const encryption = buildEncryption();

    const useCase = new UpdateAiConfigUseCase(mockGymRepo, encryption);

    await useCase.execute({ gymId: 'gym-1', provider: 'openai' });

    expect(encryption.encrypt).not.toHaveBeenCalled();
    const [, data] = mockGymRepo.update.mock.calls[0];
    expect(data.aiConfig.encryptedApiKey).toBe('enc(anterior)');
  });

  it('lanza NotFoundError si el gym no existe', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    } as any;

    const useCase = new UpdateAiConfigUseCase(mockGymRepo, buildEncryption());

    await expect(
      useCase.execute({ gymId: 'missing', promptTemplate: '{{respuestas_encuesta}}' })
    ).rejects.toThrow('Gym not found');

    expect(mockGymRepo.update).not.toHaveBeenCalled();
  });
});

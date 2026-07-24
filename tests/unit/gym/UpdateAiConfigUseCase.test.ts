import { describe, it, expect, vi } from 'vitest';
import { UpdateAiConfigUseCase } from '../../../src/application/use-cases/gym/UpdateAiConfigUseCase';

const gym = {
  id: 'gym-1',
  aiConfig: {
    provider: 'anthropic',
    promptTemplate: 'prompt viejo',
    model: 'claude-sonnet-5',
  },
};

describe('UpdateAiConfigUseCase', () => {
  it('conserva provider y model al cambiar solo el promptTemplate', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(gym),
      update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ ...gym, ...data })),
    } as any;

    const useCase = new UpdateAiConfigUseCase(mockGymRepo);

    const result = await useCase.execute({
      gymId: 'gym-1',
      promptTemplate: 'prompt nuevo',
    });

    // El bug original reemplazaba el objeto entero y dejaba aiConfig sin provider,
    // rompiendo la selección de adaptador de IA en GenerateRoutineUseCase.
    expect(mockGymRepo.update).toHaveBeenCalledWith('gym-1', {
      aiConfig: {
        provider: 'anthropic',
        promptTemplate: 'prompt nuevo',
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

    const useCase = new UpdateAiConfigUseCase(mockGymRepo);

    await useCase.execute({ gymId: 'gym-1', provider: 'openai' });

    expect(mockGymRepo.update).toHaveBeenCalledWith('gym-1', {
      aiConfig: {
        provider: 'openai',
        promptTemplate: 'prompt viejo',
        model: 'claude-sonnet-5',
      },
    });
  });

  it('lanza NotFoundError si el gym no existe', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    } as any;

    const useCase = new UpdateAiConfigUseCase(mockGymRepo);

    await expect(
      useCase.execute({ gymId: 'missing', promptTemplate: 'x' })
    ).rejects.toThrow('Gym not found');

    expect(mockGymRepo.update).not.toHaveBeenCalled();
  });
});

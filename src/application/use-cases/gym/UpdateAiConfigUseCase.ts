import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError } from '../../../shared/errors/AppError';

interface UpdateAiConfigDTO {
  gymId: string;
  promptTemplate?: string;
  provider?: 'openai' | 'anthropic';
  model?: string;
}

/**
 * Actualiza la config de IA del gym haciendo MERGE sobre la existente.
 * Reemplazar el objeto entero borraría `provider`, y GenerateRoutineUseCase
 * lo necesita para elegir el adaptador de IA del tenant.
 */
export class UpdateAiConfigUseCase {
  constructor(private gymRepository: IGymRepository) {}

  async execute(dto: UpdateAiConfigDTO): Promise<Gym> {
    const gym = await this.gymRepository.findById(dto.gymId);

    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const currentAiConfig = gym.aiConfig || {
      provider: 'openai' as const,
      promptTemplate: ''
    };

    const updatedGym = await this.gymRepository.update(dto.gymId, {
      aiConfig: {
        ...currentAiConfig,
        ...(dto.promptTemplate !== undefined && { promptTemplate: dto.promptTemplate }),
        ...(dto.provider !== undefined && { provider: dto.provider }),
        ...(dto.model !== undefined && { model: dto.model })
      }
    });

    return updatedGym!;
  }
}

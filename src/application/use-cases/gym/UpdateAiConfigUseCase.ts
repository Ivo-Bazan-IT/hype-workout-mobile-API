import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IEncryptionService } from '../../../domain/services/IEncryptionService';
import { Gym, AiProvider } from '../../../domain/entities/Gym';
import { validatePromptTemplate } from '../../../domain/prompt/promptTemplate';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface UpdateAiConfigDTO {
  gymId: string;
  promptTemplate?: string;
  provider?: AiProvider;
  model?: string;
  /** API key propia del gym (BYOK). Se cifra antes de persistir; nunca se devuelve. */
  apiKey?: string;
}

/**
 * Actualiza la config de IA del gym haciendo MERGE sobre la existente.
 * Reemplazar el objeto entero borraría `provider`, y GenerateRoutineUseCase
 * lo necesita para elegir el adaptador de IA del tenant.
 */
export class UpdateAiConfigUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private encryptionService: IEncryptionService
  ) {}

  async execute(dto: UpdateAiConfigDTO): Promise<Gym> {
    // Se valida ANTES de tocar la base: un template sin placeholders generaría
    // rutinas genéricas sin que nadie se enterara.
    if (dto.promptTemplate !== undefined) {
      const error = validatePromptTemplate(dto.promptTemplate);
      if (error) {
        throw new ValidationError(error);
      }
    }

    const gym = await this.gymRepository.findById(dto.gymId);

    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const currentAiConfig = gym.aiConfig || {
      provider: 'deepseek' as const,
      promptTemplate: ''
    };

    const updatedGym = await this.gymRepository.update(dto.gymId, {
      aiConfig: {
        ...currentAiConfig,
        ...(dto.promptTemplate !== undefined && { promptTemplate: dto.promptTemplate }),
        ...(dto.provider !== undefined && { provider: dto.provider }),
        ...(dto.model !== undefined && { model: dto.model }),
        // El cifrado lo resuelve el servicio inyectado: el caso de uso no conoce
        // el algoritmo ni la clave maestra del entorno.
        ...(dto.apiKey !== undefined && {
          encryptedApiKey: this.encryptionService.encrypt(dto.apiKey)
        })
      }
    });

    return updatedGym!;
  }
}

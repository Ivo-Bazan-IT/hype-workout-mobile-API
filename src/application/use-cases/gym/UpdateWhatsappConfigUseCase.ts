import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IEncryptionService } from '../../../domain/services/IEncryptionService';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError } from '../../../shared/errors/AppError';

interface UpdateWhatsappConfigDTO {
  gymId: string;
  phoneNumberId?: string;
  /** Access token de Meta propio del gym. Se cifra antes de persistir; nunca se devuelve. */
  accessToken?: string;
}

/**
 * Configura el WhatsApp propio del gym (Meta Cloud API).
 *
 * MERGE sobre la config existente, igual que la de IA: reemplazar el objeto entero
 * borraría el `tokenSecretRef` que se genera al crear el gym. El par
 * phoneNumberId + accessToken tiene que ser del mismo tenant, porque el PDF de la
 * rutina sale del número del gym.
 */
export class UpdateWhatsappConfigUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private encryptionService: IEncryptionService
  ) {}

  async execute(dto: UpdateWhatsappConfigDTO): Promise<Gym> {
    const gym = await this.gymRepository.findById(dto.gymId);

    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const currentWhatsappConfig = gym.whatsappConfig || {
      phoneNumberId: '',
      tokenSecretRef: ''
    };

    const updatedGym = await this.gymRepository.update(dto.gymId, {
      whatsappConfig: {
        ...currentWhatsappConfig,
        ...(dto.phoneNumberId !== undefined && { phoneNumberId: dto.phoneNumberId }),
        ...(dto.accessToken !== undefined && {
          encryptedAccessToken: this.encryptionService.encrypt(dto.accessToken)
        })
      }
    });

    return updatedGym!;
  }
}

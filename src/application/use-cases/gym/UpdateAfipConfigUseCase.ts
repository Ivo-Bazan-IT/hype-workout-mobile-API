import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IEncryptionService } from '../../../domain/services/IEncryptionService';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError } from '../../../shared/errors/AppError';

interface UpdateAfipConfigDTO {
  gymId: string;
  apiKey?: string;
  puntoVenta?: number;
  taxCondition?: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO' | 'EXENTO';
  isActive?: boolean;
}

export class UpdateAfipConfigUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private encryptionService: IEncryptionService
  ) {}

  async execute(dto: UpdateAfipConfigDTO): Promise<Gym> {
    const gym = await this.gymRepository.findById(dto.gymId);

    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const currentAfipConfig = gym.afipConfig || {
      puntoVenta: 1,
      taxCondition: 'MONOTRIBUTO' as const,
      apiKeySecretRef: '',
      isActive: false
    };

    const updateData: Partial<Gym> = {};

    if (dto.apiKey !== undefined) {
      // El servicio de cifrado valida internamente la clave maestra (APP_MASTER_KEY);
      // el caso de uso no necesita conocer el entorno.
      updateData.afipConfig = {
        ...currentAfipConfig,
        encryptedApiKey: this.encryptionService.encrypt(dto.apiKey)
      };
    }

    if (dto.puntoVenta !== undefined || dto.taxCondition !== undefined || dto.isActive !== undefined) {
      updateData.afipConfig = {
        ...currentAfipConfig,
        ...(dto.puntoVenta !== undefined && { puntoVenta: dto.puntoVenta }),
        ...(dto.taxCondition !== undefined && { taxCondition: dto.taxCondition }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive })
      };
    }

    const updatedGym = await this.gymRepository.update(dto.gymId, updateData);

    return updatedGym!;
  }
}
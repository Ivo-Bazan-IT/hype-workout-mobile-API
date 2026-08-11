import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IWebhookSecretService } from '../../../domain/services/IWebhookSecretService';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError } from '../../../shared/errors/AppError';

interface RotateGoogleFormSecretDTO {
  gymId: string;
}

interface RotateGoogleFormSecretResult {
  gym: Gym;
  /**
   * Secreto en claro. Único punto del sistema por donde sale: se guarda hasheado,
   * así que quien llame tiene que mostrárselo al usuario ahí mismo.
   */
  secret: string;
}

/**
 * Genera un secreto nuevo para el webhook del Google Form del gym y persiste solo
 * su hash.
 *
 * MERGE sobre la config existente, igual que la de IA y la de WhatsApp: reemplazar
 * el objeto entero borraría el `formId` que el gym ya tenía cargado.
 *
 * Rotar INVALIDA el secreto anterior, así que el Apps Script del Form deja de entrar
 * hasta que se le pegue el nuevo. Es el precio de que el secreto no sea recuperable.
 */
export class RotateGoogleFormSecretUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private webhookSecretService: IWebhookSecretService
  ) {}

  async execute(dto: RotateGoogleFormSecretDTO): Promise<RotateGoogleFormSecretResult> {
    const gym = await this.gymRepository.findById(dto.gymId);

    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const secret = this.webhookSecretService.generar();
    const webhookSecretHash = await this.webhookSecretService.hash(secret);

    const updatedGym = await this.gymRepository.update(dto.gymId, {
      googleFormConfig: {
        ...(gym.googleFormConfig || {}),
        webhookSecretHash,
        webhookSecretUpdatedAt: new Date(),
      },
    });

    return { gym: updatedGym!, secret };
  }
}

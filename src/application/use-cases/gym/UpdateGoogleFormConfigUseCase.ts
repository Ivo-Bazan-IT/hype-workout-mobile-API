import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Gym } from '../../../domain/entities/Gym';
import { FormFieldMapping } from '../../../domain/forms/fieldMapping';
import { NotFoundError } from '../../../shared/errors/AppError';

interface UpdateGoogleFormConfigDTO {
  gymId: string;
  formId?: string;
  fieldMapping?: FormFieldMapping;
}

/**
 * Configura el Google Form de onboarding del gym.
 *
 * Solo toca los campos no sensibles: el secreto del webhook NO se edita por acá, se
 * rota con `RotateGoogleFormSecretUseCase`. El merge sobre la config existente es lo
 * que evita que cambiar el `formId` borre el `webhookSecretHash` del gym.
 */
export class UpdateGoogleFormConfigUseCase {
  constructor(private gymRepository: IGymRepository) {}

  async execute(dto: UpdateGoogleFormConfigDTO): Promise<Gym> {
    const gym = await this.gymRepository.findById(dto.gymId);

    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const updatedGym = await this.gymRepository.update(dto.gymId, {
      googleFormConfig: {
        ...(gym.googleFormConfig || {}),
        ...(dto.formId !== undefined && { formId: dto.formId }),
        // El mapeo también hace merge campo por campo: mandar solo `telefono` no
        // puede borrar el `nombre` que ya estaba corregido.
        ...(dto.fieldMapping !== undefined && {
          fieldMapping: {
            ...(gym.googleFormConfig?.fieldMapping || {}),
            ...dto.fieldMapping,
          },
        }),
      },
    });

    return updatedGym!;
  }
}

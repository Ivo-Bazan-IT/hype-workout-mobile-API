import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

export class UpdateServiciosUseCase {
  constructor(private gymRepository: IGymRepository) {}

  async execute(dto: { gymId: string; servicios: any[] }): Promise<Gym> {
    const gym = await this.gymRepository.findById(dto.gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }

    for (const servicio of dto.servicios) {
      if (!servicio.nombre || servicio.precio <= 0) {
        throw new ValidationError('Servicio debe tener nombre y precio > 0');
      }
      if (servicio.tipoCobro === 'recurrente' && !servicio.duracionDias) {
        throw new ValidationError('Servicio recurrente requiere duracionDias');
      }
    }

    return this.gymRepository.update(dto.gymId, { servicios: dto.servicios }) as Promise<Gym>;
  }
}

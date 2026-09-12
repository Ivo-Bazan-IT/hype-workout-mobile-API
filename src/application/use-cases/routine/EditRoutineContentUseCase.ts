import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface EditRoutineContentDTO {
  routineId: string;
  gymId: string;
  contenidoEditado: Record<string, any>;
}

export class EditRoutineContentUseCase {
  constructor(private routineRepository: IRoutineRepository) {}

  async execute(dto: EditRoutineContentDTO): Promise<any> {
    const routine = await this.routineRepository.findById(dto.routineId, dto.gymId);
    if (!routine) {
      throw new NotFoundError('Routine');
    }
    if (routine.estadoGeneracion !== 'generado') {
      throw new ValidationError('Solo se puede editar una rutina en estado generado.');
    }

    const updates: any = {
      contenidoGenerado: dto.contenidoEditado,
      editadoManualmente: true,
    };
    if (!routine.editadoManualmente) {
      updates.contenidoOriginalIA = routine.contenidoGenerado;
    }

    const updated = await this.routineRepository.update(dto.routineId, dto.gymId, updates);
    return updated;
  }
}

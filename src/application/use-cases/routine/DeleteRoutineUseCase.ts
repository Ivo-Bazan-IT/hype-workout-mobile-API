import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { NotFoundError } from '../../../shared/errors/AppError';

interface DeleteRoutineDTO {
  routineId: string;
  gymId: string;
}

export class DeleteRoutineUseCase {
  constructor(private routineRepository: IRoutineRepository) {}

  async execute(dto: DeleteRoutineDTO): Promise<boolean> {
    const deleted = await this.routineRepository.delete(dto.routineId, dto.gymId);

    if (!deleted) {
      throw new NotFoundError('Routine');
    }

    return true;
  }
}

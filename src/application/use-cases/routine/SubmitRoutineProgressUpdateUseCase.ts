import { IProgressUpdateRepository } from '../../../domain/repositories/IProgressUpdateRepository';
import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { RoutineProgressUpdate } from '../../../domain/entities/RoutineProgressUpdate';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface SubmitRoutineProgressUpdateDTO {
  routineId: string;
  gymId: string;
  clientId: string;
  semana: number;
  datos: Record<string, any>;
}

export class SubmitRoutineProgressUpdateUseCase {
  constructor(
    private progressRepo: IProgressUpdateRepository,
    private routineRepo: IRoutineRepository
  ) {}

  async execute(dto: SubmitRoutineProgressUpdateDTO): Promise<RoutineProgressUpdate> {
    const routine = await this.routineRepo.findById(dto.routineId, dto.gymId);
    if (!routine) throw new NotFoundError('Routine');
    if (routine.clientId !== dto.clientId) {
      throw new ValidationError('Routine does not belong to this client.');
    }

    const existing = await this.progressRepo.findByGymClientSemana(dto.gymId, dto.clientId, dto.semana);
    if (existing) {
      return this.progressRepo.update(existing.id, dto.gymId, { datos: dto.datos }) as Promise<RoutineProgressUpdate>;
    }

    return this.progressRepo.create({
      gymId: dto.gymId,
      routineId: dto.routineId,
      clientId: dto.clientId,
      semana: dto.semana,
      datos: dto.datos,
      estado: 'pendiente_revision',
    });
  }
}

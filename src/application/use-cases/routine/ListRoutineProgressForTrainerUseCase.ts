import { IProgressUpdateRepository } from '../../../domain/repositories/IProgressUpdateRepository';
import { RoutineProgressUpdate } from '../../../domain/entities/RoutineProgressUpdate';

export class ListRoutineProgressForTrainerUseCase {
  constructor(private progressRepo: IProgressUpdateRepository) {}

  async execute(gymId: string): Promise<RoutineProgressUpdate[]> {
    return this.progressRepo.searchPendientesByGym(gymId);
  }
}

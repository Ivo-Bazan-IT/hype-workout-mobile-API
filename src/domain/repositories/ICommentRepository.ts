import { RoutineComment } from '../entities/RoutineComment';

export interface ICommentRepository {
  create(data: Partial<RoutineComment>): Promise<RoutineComment>;
  findByRoutineId(routineId: string, gymId: string): Promise<RoutineComment[]>;
}

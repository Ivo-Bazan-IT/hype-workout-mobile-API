import { RoutineProgressUpdate } from '../entities/RoutineProgressUpdate';

export interface IProgressUpdateRepository {
  create(data: Partial<RoutineProgressUpdate>): Promise<RoutineProgressUpdate>;
  findByRoutineId(routineId: string, gymId: string): Promise<RoutineProgressUpdate[]>;
  findByGymClientSemana(gymId: string, clientId: string, semana: number): Promise<RoutineProgressUpdate | null>;
  update(id: string, gymId: string, data: Partial<RoutineProgressUpdate>): Promise<RoutineProgressUpdate | null>;
  searchPendientesByGym(gymId: string): Promise<RoutineProgressUpdate[]>;
}

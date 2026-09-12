export type ProgressUpdateStatus = 'pendiente_revision' | 'revisado';

export interface RoutineProgressUpdate {
  id: string;
  gymId: string;
  routineId: string;
  clientId: string;
  semana: number;
  datos: Record<string, any>;
  estado: ProgressUpdateStatus;
  createdAt: Date;
  updatedAt: Date;
}

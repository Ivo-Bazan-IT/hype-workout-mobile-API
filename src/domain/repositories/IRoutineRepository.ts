import { Routine, RoutineGenerationStatus, RoutineSendStatus } from '../entities/Routine';

export interface IRoutineRepository {
  create(routine: Omit<Routine, 'id' | 'createdAt' | 'updatedAt' | 'estadoGeneracion' | 'estadoEnvio'>): Promise<Routine>;
  findById(id: string, gymId: string): Promise<Routine | null>;
  findByClientId(clientId: string, gymId: string): Promise<Routine[]>;
  update(id: string, gymId: string, data: Partial<Routine>): Promise<Routine | null>;
  updateStatus(id: string, gymId: string, estadoGeneracion: RoutineGenerationStatus, estadoEnvio?: RoutineSendStatus): Promise<Routine | null>;
  getExpiringSoon(gymId: string, days: number): Promise<Routine[]>;
  countExpiringByDay(gymId: string, days: number): Promise<number>;
}

export interface IRoutineQueueData {
  routineId: string;
  gymId: string;
  clientId: string;
}
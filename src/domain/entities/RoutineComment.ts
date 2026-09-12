export interface RoutineComment {
  id: string;
  gymId: string;
  routineId: string;
  clientId: string;
  autorUserId: string;
  autorRol: 'entrenador' | 'cliente';
  texto: string;
  createdAt: Date;
}

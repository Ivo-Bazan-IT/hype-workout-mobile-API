import { Routine, RoutineGenerationStatus, RoutineSendStatus } from '../entities/Routine';
import { PaginatedResult } from './IClientRepository';

export interface RoutineSearchFilters {
  clientId?: string;
  estadoEnvio?: RoutineSendStatus;
  estadoGeneracion?: RoutineGenerationStatus;
  vencimientoDesde?: Date;
  vencimientoHasta?: Date;
}

/**
 * Una fila del listado de rutinas, con el nombre del socio ya resuelto.
 *
 * Misma lección que `CheckInListItem`: el nombre no pertenece a la rutina, pero una
 * pantalla de rutinas sin él es una lista de ids. Resolverlo acá cuesta un `$lookup`
 * sobre la página ya paginada; del lado del front cuesta cruzar cada fila contra un
 * padrón cacheado que puede no tenerla —y ese cruce ya se borró una vez.
 *
 * `null` si el socio fue borrado: la rutina que se le generó sigue siendo un hecho, y
 * perder la fila entera sería peor que perder el nombre.
 */
export interface RoutineListItem extends Routine {
  readonly clientNombre: string | null;
}

export interface IRoutineRepository {
  create(routine: Omit<Routine, 'id' | 'createdAt' | 'updatedAt' | 'estadoGeneracion' | 'estadoEnvio'>): Promise<Routine>;
  findById(id: string, gymId: string): Promise<Routine | null>;
  findByClientId(clientId: string, gymId: string): Promise<Routine[]>;

  /**
   * Listado paginado de las rutinas del gym.
   *
   * Existe porque sin él la pantalla de rutinas pagina socios y dispara una consulta
   * por socio visible, con lo cual sus filtros —"pendientes", "sin rutina"— trabajan
   * sobre la página cargada y no sobre el gimnasio. Filtrar de a doce filas no es
   * filtrar: el socio con la rutina trabada que quedó en la página 4 no aparece.
   */
  search(
    gymId: string,
    filters: RoutineSearchFilters,
    page?: number,
    limit?: number
  ): Promise<PaginatedResult<RoutineListItem>>;
  update(id: string, gymId: string, data: Partial<Routine>): Promise<Routine | null>;
  updateStatus(id: string, gymId: string, estadoGeneracion: RoutineGenerationStatus, estadoEnvio?: RoutineSendStatus): Promise<Routine | null>;
  getExpiringSoon(gymId: string, days: number): Promise<Routine[]>;
  countExpiringByDay(gymId: string, days: number): Promise<number>;

  /**
   * Cuántas rutinas del gym están en un estado de envío dado.
   *
   * Existe para `rutinasSinEnviar` en el dashboard: son las rutinas generadas que
   * nunca salieron hacia el socio. A diferencia del resto de los huecos del tablero,
   * acá un 0 es un dato real y no un `null` — significa que no hay ninguna trabada.
   */
  countBySendStatus(gymId: string, estadoEnvio: RoutineSendStatus): Promise<number>;
}

export interface IRoutineQueueData {
  routineId: string;
  gymId: string;
  clientId: string;
}
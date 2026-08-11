import { CheckIn } from '../entities/CheckIn';
import { DateRange } from '../kpis/types';
import { PaginatedResult } from './IClientRepository';

export interface CheckInSearchFilters {
  clientId?: string;
  desde?: Date;
  hasta?: Date;
}

/**
 * Una celda del mapa de calor: cuánta gente entró un día de semana a una hora dada.
 *
 * `dia` va en numeración **ISO-8601: 1 = lunes … 7 = domingo**, y está dicho acá
 * porque es el lugar exacto donde el mapa sale corrido un día. Mongo tiene dos
 * operadores parecidos y solo uno sirve: `$dayOfWeek` arranca en domingo (1 = domingo)
 * y `$isoDayOfWeek` en lunes. El contrato con el front es el segundo.
 *
 * `hora` va de 0 a 23 en la hora de pared del GIMNASIO, no en UTC.
 */
export interface HeatmapCell {
  readonly dia: number;
  readonly hora: number;
  readonly total: number;
}

/**
 * Una fila del historial de asistencia, con el nombre del socio ya resuelto.
 *
 * El nombre no vive en `CheckIn` —una asistencia es quién, dónde y cuándo, y nada
 * más— pero la pantalla que la muestra sin él es una lista de ids. Resolverlo acá
 * cuesta un `$lookup` sobre la página ya paginada; hacerlo del lado del front cuesta
 * cruzar cada fila contra un padrón cacheado que puede no tenerla.
 *
 * `null` si el socio ya no existe: una asistencia vieja de alguien borrado sigue
 * siendo un hecho, y perder la fila entera sería peor que perder el nombre.
 */
export interface CheckInListItem extends CheckIn {
  readonly clientNombre: string | null;
}

export interface ICheckInRepository {
  create(checkIn: Omit<CheckIn, 'id' | 'createdAt' | 'updatedAt'>): Promise<CheckIn>;

  /**
   * Asistencia ya registrada de ese socio ese día, si la hay.
   *
   * Existe para que registrar dos veces el mismo ingreso no cuente como dos visitas:
   * un molinete o un recepcionista apurado disparan el alta repetida con facilidad, y
   * la frecuencia de visita —el predictor de churn más fuerte que tenemos— se
   * duplicaría sin que nada falle.
   *
   * El día llega **resuelto como rango**, no como una fecha suelta: qué instantes
   * abarca "el lunes" depende de la zona horaria del gimnasio, y esa cuenta es del
   * dominio (`domain/time/zonaHoraria`). Antes la hacía este adaptador con
   * `setHours(0,0,0,0)`, que corta en la hora del proceso Node — así, un ingreso de
   * las 21:30 hora argentina con el server en UTC caía en el día siguiente y el
   * mismo socio podía registrarse dos veces esa noche.
   */
  findByClientAndDay(clientId: string, gymId: string, dia: DateRange): Promise<CheckIn | null>;

  search(
    gymId: string,
    filters: CheckInSearchFilters,
    page?: number,
    limit?: number
  ): Promise<PaginatedResult<CheckInListItem>>;

  /**
   * Asistencias del período agrupadas por día de semana y hora del gimnasio.
   *
   * **Es la excepción justificada a la regla de `IMetricsRepository`** —que el puerto
   * materialice los datos y el dominio haga la cuenta—, y conviene decir por qué. Esa
   * regla existe para no escribir dos veces la definición de quién es socio; acá no
   * hay ninguna regla de negocio que duplicar: es contar filas agrupadas por dos
   * campos derivados de un timestamp. Y hay una razón para NO traerlas: un gimnasio
   * de 300 socios genera unos 10.000 check-ins por trimestre, así que materializarlos
   * sería traer todo a memoria para tirarlo después de sumar.
   *
   * `timezone` es un nombre IANA y no es opcional: sin él la agrupación se haría en
   * UTC y el pico real de las 19:00 en Argentina aparecería a las 22:00, con lo cual
   * el mapa deja de significar nada. Quien llama resuelve el default.
   *
   * Las celdas en cero NO vienen: el resultado es disperso. Quien consume distingue
   * "no vino nadie" de "todavía no se registraba asistencia" con el rango y la fecha
   * del primer registro, no con la ausencia de la celda.
   */
  getHeatmap(
    gymId: string,
    range: DateRange,
    timezone: string
  ): Promise<HeatmapCell[]>;
}

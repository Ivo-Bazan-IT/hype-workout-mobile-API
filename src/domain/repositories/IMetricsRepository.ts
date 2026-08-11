import { LeadRecord } from '../kpis/funnel';
import { MembershipWindow } from '../kpis/membership';
import { Cents, DateRange } from '../kpis/types';

/**
 * Contrato de lectura para el cálculo de KPIs.
 *
 * **Por qué devuelve datos y no números ya agregados.** La regla que define quién
 * es socio —ventanas de membresía encadenadas con 5 días de gracia— vive en
 * `domain/kpis/membership.ts`. Si el conteo se hiciera con un pipeline de
 * agregación en Mongo, esa regla quedaría escrita dos veces: una en el dominio y
 * otra en un pipeline que nadie puede testear sin base de datos, y el día que
 * cambie la gracia habría que acordarse de tocar las dos. Por eso el puerto
 * materializa el historial y el dominio hace la cuenta.
 *
 * El costo es traer el historial del gym a memoria. Para el tamaño de un gimnasio
 * —cientos de socios, decenas de eventos cada uno— es despreciable, y la consulta
 * proyecta solo los campos necesarios en vez de documentos completos. Si algún día
 * un tenant lo hace pesar, el reemplazo natural es un read-model materializado
 * detrás de este mismo puerto, sin tocar el dominio ni el caso de uso.
 */

/** Ventana de membresía con lo que se cobró por ella, para poder normalizar el MRR. */
export interface PaidMembershipWindow extends MembershipWindow {
  /** `null` si la operación no registró cobro (un alta o un ajuste manual). */
  readonly monto: Cents | null;
}

export interface MembershipPayment {
  readonly fecha: Date;
  readonly monto: Cents;
}

export interface ClientMembershipHistory {
  readonly clientId: string;
  /**
   * Nombre del socio, o `null` si el cliente ya no existe.
   *
   * Es el único campo de este contrato que no participa de ningún cálculo: está para
   * que `engagement.enRiesgo` pueda devolver socios y no una lista de ObjectIds. Sale
   * del `$lookup` a `clients` que el pipeline ya hacía para excluir a los eliminados,
   * así que no cuesta una consulta extra.
   */
  readonly nombre: string | null;
  /** Fecha del alta: el arranque de la relación, aunque después haya habido huecos. */
  readonly fechaAlta: Date;
  /**
   * Solo las ventanas de vencimiento CONOCIDO. Las renovaciones históricas que no
   * registraron vencimiento quedan afuera a propósito: sin ese dato no se puede
   * saber si hubo un hueco, y estimarlo sería inventar churn.
   */
  readonly windows: ReadonlyArray<PaidMembershipWindow>;
  /**
   * Todos los cobros del socio, incluidos los de las renovaciones históricas que no
   * dibujan ventana. Es la fuente de los KPIs de ingreso, que sí tienen historia
   * real hacia atrás. Se solapa con `windows[].monto` — el ingreso se suma de acá,
   * no de las ventanas, para no contar dos veces.
   */
  readonly pagos: ReadonlyArray<MembershipPayment>;
}

export interface MemberLastCheckIn {
  readonly clientId: string;
  readonly lastCheckInAt: Date;
}

export interface IMetricsRepository {
  /**
   * Historial de membresía de todos los socios vigentes del gym.
   * Excluye a los eliminados (`estado: 'inactivo'`), que son borrado lógico y no
   * bajas de negocio: contarlos como churn ensuciaría la métrica con altas
   * cargadas por error.
   */
  getMembershipHistories(gymId: string): Promise<ClientMembershipHistory[]>;

  /**
   * Momento a partir del cual el stream de eventos es completo, o `null` si el gym
   * todavía no tiene ningún evento.
   *
   * Antes de esta fecha no se puede afirmar quién estaba activo: las renovaciones
   * previas a la siembra no registraron vencimiento. Los KPIs de retención de un
   * período anterior se devuelven en `null` en vez de estimarse.
   */
  getDataCutoff(gymId: string): Promise<Date | null>;

  /** Total de asistencias del gym en el período. */
  countCheckIns(gymId: string, range: DateRange): Promise<number>;

  /**
   * Última asistencia de cada socio que alguna vez vino. Los que nunca vinieron no
   * aparecen: el caso de uso los completa con `null`, que es el riesgo más alto.
   */
  getLastCheckInByClient(gymId: string): Promise<MemberLastCheckIn[]>;

  /**
   * Primera asistencia registrada del gym, o `null` si nunca registró ninguna.
   *
   * Marca desde cuándo hay registro de asistencia, que no es lo mismo que desde
   * cuándo el gym opera. Sin este dato, el día que se activa la función todos los
   * socios aparecerían como "hace 14 días que no vienen" — que sería un artefacto
   * del sistema, no una verdad sobre el gimnasio.
   */
  getFirstCheckInDate(gymId: string): Promise<Date | null>;

  /**
   * Los prospectos que entraron al embudo dentro del rango, o sea los clientes
   * dados de alta en él. Excluye a los eliminados, igual que el historial de
   * membresía: un alta cargada por error no es un lead que se perdió.
   *
   * Devuelve los registros y no un promedio ya calculado por el mismo motivo que
   * `getMembershipHistories`: la censura de la cohorte y el promedio de respuesta
   * son reglas de `domain/kpis/funnel.ts` y no deben quedar escritas también en un
   * pipeline de agregación que nadie puede testear sin base.
   */
  getLeadCohort(gymId: string, range: DateRange): Promise<LeadRecord[]>;

  /**
   * Conversiones OCURRIDAS en el rango, sin importar cuándo entró el lead.
   *
   * Es distinto de contar los convertidos de `getLeadCohort`: un lead de enero que
   * contesta la encuesta en marzo es conversión de marzo y cohorte de enero. Las dos
   * lecturas son legítimas y el dashboard muestra las dos.
   *
   * No cuenta a los convertidos sin `fechaConversion` (los anteriores a la tanda 4):
   * su conversión existe pero no tiene fecha, así que no pertenece a ningún período.
   */
  countConversions(gymId: string, range: DateRange): Promise<number>;
}

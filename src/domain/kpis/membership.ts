/**
 * Ventanas de membresía, período de gracia y derivación de la baja.
 *
 * Este módulo es el que traduce la regla de negocio del gimnasio al modelo de
 * datos, y del que dependen todos los KPIs de retención. Vale la pena leerlo antes
 * que `retention.ts`.
 *
 * **La baja no es un evento que alguien dispara: es el vencimiento sin renovación.**
 * Un socio puede vencer, pasar meses afuera y volver; cuando vuelve se renueva la
 * membresía y se extiende `fechaVencimiento`. Por eso la vida de un socio no es un
 * intervalo, sino una secuencia de ventanas con huecos entre medio.
 *
 * Sobre esa secuencia se aplica el **período de gracia** (5 días, una semana hábil):
 *
 *  - Renovar DENTRO de la gracia es pagar tarde, no darse de baja y volver. Las dos
 *    ventanas se fusionan en un tramo continuo y el churn del período no se mueve.
 *  - Pasada la gracia la baja queda firme. Una renovación posterior es una
 *    REACTIVACIÓN, y se imputa al período en que ocurre: nunca reescribe el churn
 *    de un período ya cerrado, porque un dashboard cuyos números de meses pasados
 *    cambian solos no sirve para tomar decisiones.
 *
 * Ojo con lo que NO entra acá: `estado: 'inactivo'` en `Client` es borrado lógico
 * (soft delete), no una baja de negocio. Esos socios se excluyen de la base antes
 * de llegar a estas funciones — si se colaran, contarían como churn y ensuciarían
 * la métrica con altas cargadas por error.
 */

import { DateRange, diasEntre, MS_POR_DIA } from './types';

/** Días posteriores al vencimiento en los que una renovación todavía cuenta como continuidad. */
export const DIAS_DE_GRACIA_POR_DEFECTO = 5;

/**
 * Un período pago de membresía: desde que se dio el alta o se renovó, hasta el
 * vencimiento que esa operación dejó. Los nombres van en español porque son los
 * mismos campos de `Client` / del stream de eventos de membresía.
 */
export interface MembershipWindow {
  readonly inicio: Date;
  readonly vencimiento: Date;
}

/**
 * Tramo de membresía CONTINUA: una o más ventanas encadenadas sin superar la
 * gracia. `fin` es el vencimiento del tramo, sin la gracia sumada.
 */
export interface MembershipSegment {
  readonly inicio: Date;
  readonly fin: Date;
}

/**
 * Estado de la membresía en un momento dado.
 *
 * `en_gracia` no es un tecnicismo: son exactamente los socios a los que hay que
 * llamar hoy. Distinguirlo de `de_baja` es la diferencia entre retener y perder.
 */
export type MembershipStatus = 'vigente' | 'en_gracia' | 'de_baja';

const porInicio = (a: MembershipWindow, b: MembershipWindow): number =>
  a.inicio.getTime() - b.inicio.getTime();

const masTardio = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);

/**
 * Fusiona las ventanas en tramos de membresía continua.
 *
 * Dos ventanas se encadenan si la siguiente arranca dentro de la gracia posterior
 * al vencimiento de la anterior. El caso normal es incluso más simple: casi todo el
 * mundo renueva ANTES de vencer, así que el hueco es negativo y el encadenamiento
 * es obvio; la gracia existe para el que se atrasa unos días.
 *
 * No muta la entrada: ordena sobre una copia, porque recibir las ventanas ya
 * ordenadas no es algo que este módulo pueda garantizar.
 */
export function membershipSegments(
  windows: ReadonlyArray<MembershipWindow>,
  diasDeGracia: number = DIAS_DE_GRACIA_POR_DEFECTO
): MembershipSegment[] {
  if (windows.length === 0) {
    return [];
  }

  const ordenadas = [...windows].sort(porInicio);
  const segmentos: MembershipSegment[] = [];

  let inicio = ordenadas[0].inicio;
  let fin = ordenadas[0].vencimiento;

  for (const ventana of ordenadas.slice(1)) {
    const huecoEnDias = diasEntre(fin, ventana.inicio);

    if (huecoEnDias <= diasDeGracia) {
      // Renovación a tiempo (o atrasada pero dentro de la gracia): mismo tramo.
      // Se toma el vencimiento más tardío porque una renovación anticipada puede
      // dejar un vencimiento anterior al que ya había.
      fin = masTardio(fin, ventana.vencimiento);
    } else {
      segmentos.push({ inicio, fin });
      inicio = ventana.inicio;
      fin = ventana.vencimiento;
    }
  }

  segmentos.push({ inicio, fin });

  return segmentos;
}

/**
 * Fechas en las que la baja quedó firme: el vencimiento de cada tramo más la
 * gracia. Pueden ser futuras — el tramo vigente también tiene su fecha de baja
 * proyectada, y es quien consume el dato el que la compara contra el período.
 */
export function churnDates(
  windows: ReadonlyArray<MembershipWindow>,
  diasDeGracia: number = DIAS_DE_GRACIA_POR_DEFECTO
): Date[] {
  return membershipSegments(windows, diasDeGracia).map(
    (s) => new Date(s.fin.getTime() + diasDeGracia * MS_POR_DIA)
  );
}

/**
 * Inicio de cada tramo que no es el primero: el socio se había ido y volvió.
 * El alta original no es una reactivación, por eso se descarta el primer tramo.
 */
export function reactivationDates(
  windows: ReadonlyArray<MembershipWindow>,
  diasDeGracia: number = DIAS_DE_GRACIA_POR_DEFECTO
): Date[] {
  return membershipSegments(windows, diasDeGracia)
    .slice(1)
    .map((s) => s.inicio);
}

/**
 * Primera baja del socio, o `null` si nunca se fue.
 *
 * Es el `cancelledAt` que pide el análisis de cohortes: para medir si sobrevivió a
 * los primeros 90 días importa la primera vez que se fue, no la última.
 */
export function firstChurnDate(
  windows: ReadonlyArray<MembershipWindow>,
  at: Date,
  diasDeGracia: number = DIAS_DE_GRACIA_POR_DEFECTO
): Date | null {
  const pasadas = churnDates(windows, diasDeGracia).filter(
    (f) => f.getTime() <= at.getTime()
  );

  return pasadas.length > 0 ? pasadas[0] : null;
}

/** Estado de la membresía en un momento puntual. */
export function membershipStatusAt(input: {
  windows: ReadonlyArray<MembershipWindow>;
  at: Date;
  diasDeGracia?: number;
}): MembershipStatus {
  const diasDeGracia = input.diasDeGracia ?? DIAS_DE_GRACIA_POR_DEFECTO;
  const momento = input.at.getTime();

  for (const segmento of membershipSegments(input.windows, diasDeGracia)) {
    if (momento < segmento.inicio.getTime()) {
      continue;
    }
    if (momento <= segmento.fin.getTime()) {
      return 'vigente';
    }
    if (diasEntre(segmento.fin, input.at) <= diasDeGracia) {
      return 'en_gracia';
    }
  }

  return 'de_baja';
}

/**
 * ¿Contaba como socio en esa fecha? Los que están en gracia cuentan que sí: la
 * baja todavía no quedó firme, y excluirlos adelantaría el churn cinco días.
 *
 * Es la primitiva del conteo puntual (`countActiveAt`) del que dependen el churn y
 * la retención: ambos necesitan la base al INICIO del período, no un promedio.
 */
export function isActiveAt(
  windows: ReadonlyArray<MembershipWindow>,
  at: Date,
  diasDeGracia: number = DIAS_DE_GRACIA_POR_DEFECTO
): boolean {
  return membershipStatusAt({ windows, at, diasDeGracia }) !== 'de_baja';
}

/**
 * La ventana que rige en una fecha dada: la última que arrancó antes de ese
 * momento.
 *
 * Es "la última que arrancó" y no "la que contiene la fecha" a propósito, porque un
 * socio en gracia ya no está contenido en ninguna ventana y sin embargo sigue
 * teniendo una cuota vigente — la de su último pago. Ese es justamente el caso que
 * el MRR necesita resolver bien.
 *
 * Genérica para no perder los datos que el llamador haya colgado de la ventana
 * (típicamente el monto pagado).
 */
export function windowAt<T extends MembershipWindow>(
  windows: ReadonlyArray<T>,
  at: Date
): T | null {
  const momento = at.getTime();

  let vigente: T | null = null;

  for (const ventana of windows) {
    if (ventana.inicio.getTime() > momento) {
      continue;
    }
    if (vigente === null || ventana.inicio.getTime() > vigente.inicio.getTime()) {
      vigente = ventana;
    }
  }

  return vigente;
}

/** ¿Cayó alguna baja de este socio dentro del período `[start, end)`? */
export function churnedDuring(
  windows: ReadonlyArray<MembershipWindow>,
  range: DateRange,
  diasDeGracia: number = DIAS_DE_GRACIA_POR_DEFECTO
): boolean {
  const desde = range.start.getTime();
  const hasta = range.end.getTime();

  return churnDates(windows, diasDeGracia).some(
    (f) => f.getTime() >= desde && f.getTime() < hasta
  );
}

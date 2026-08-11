/**
 * Engagement y uso — los mejores predictores ADELANTADOS de churn.
 *
 * La diferencia con el bloque de retención es de tiempo: el churn te dice a quién
 * ya perdiste, esto te dice a quién estás por perder. Son además las métricas que
 * el CRM puede accionar solo, disparando la intervención antes de la baja.
 *
 * Todo este bloque se alimenta del stream de check-ins (asistencias), que todavía
 * no existe como entidad en el repo.
 */

import { DIAS_POR_SEMANA, Rate, diasEntre } from './types';

/**
 * Piso de días para que un promedio semanal signifique algo.
 *
 * Que sea exactamente una semana no es arbitrario: es la unidad en la que se
 * expresa la métrica. Por debajo, dividir por `periodDays / 7` deja de promediar y
 * pasa a extrapolar —siete horas de registro proyectadas a siete días dieron 23,2
 * visitas por socio en un gimnasio que había registrado dos ingresos en total—.
 */
export const DIAS_MINIMOS_PARA_PROMEDIO_SEMANAL = DIAS_POR_SEMANA;

/**
 * Promedio de visitas por socio por semana.
 *
 * Es el predictor de churn más fuerte que hay: quien va 2+ veces por semana tiene
 * la mitad de probabilidad de cancelar que quien va una vez o menos, y 8+ visitas
 * al mes marca a los socios sólidos.
 *
 * Se normaliza por semana —y no por período— para que un mes y una quincena sean
 * comparables entre sí.
 *
 * Con menos de una semana de período devuelve `null`, y el corte aplica tanto si el
 * registro es nuevo como si el rango pedido es corto: un gym con un año de
 * asistencias al que le piden tres días recibe `null` igual. Un promedio semanal
 * sobre menos de una semana no es un dato incompleto, es un dato inexistente — y un
 * número grande y preciso donde no se sabe engaña más que un hueco, porque un `null`
 * se lee como "todavía no" y un `23,2` se lee como un hallazgo.
 */
export function avgVisitsPerMemberPerWeek(input: {
  totalCheckIns: number;
  activeMembers: number;
  periodDays: number;
}): number | null {
  const { totalCheckIns, activeMembers, periodDays } = input;

  if (activeMembers <= 0 || periodDays < DIAS_MINIMOS_PARA_PROMEDIO_SEMANAL) {
    return null;
  }

  const semanas = periodDays / DIAS_POR_SEMANA;

  return totalCheckIns / activeMembers / semanas;
}

export interface MemberActivity {
  readonly memberId: string;
  readonly lastCheckInAt: Date | null;
}

/**
 * Socios sin actividad reciente: los candidatos a una intervención proactiva antes
 * de que se den de baja.
 *
 * Dos semanas sin registrar ingreso es riesgo alto de churn. Devuelve IDs y no un
 * conteo justamente porque el consumidor es una campaña —mensaje automático,
 * oferta, llamada—, no un número en una tarjeta.
 *
 * Quien nunca asistió (`lastCheckInAt === null`) es riesgo por definición, y de los
 * peores: pagó y no apareció nunca.
 */
export function findAtRiskMembers(input: {
  members: ReadonlyArray<MemberActivity>;
  staleDays: number;
  now: Date;
}): string[] {
  const { members, staleDays, now } = input;

  return members
    .filter((m) => {
      if (m.lastCheckInAt === null) {
        return true;
      }
      return diasEntre(m.lastCheckInAt, now) >= staleDays;
    })
    .map((m) => m.memberId);
}

/**
 * Qué proporción de los socios activos asistió al menos a una clase grupal en la
 * semana.
 *
 * El 85% de quienes van a al menos una clase por semana siguen siendo socios un año
 * o más. Es una palanca de retención medible y adelantada: si este número baja, el
 * churn de los próximos meses probablemente suba.
 */
export function weeklyClassParticipationRate(input: {
  membersWithClassAttendance: number;
  activeMembers: number;
}): Rate | null {
  const { membersWithClassAttendance, activeMembers } = input;

  if (activeMembers <= 0) {
    return null;
  }

  return membersWithClassAttendance / activeMembers;
}

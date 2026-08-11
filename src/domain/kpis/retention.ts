/**
 * Retención y churn — el núcleo del negocio.
 *
 * Adquirir un socio nuevo cuesta entre 5 y 7 veces más que retener a uno actual, y
 * mejorar la retención un 5% puede subir las ganancias entre 25% y 95%. Por eso
 * este bloque manda: el churn además es el denominador del LTV (ver
 * `financial.ts`), así que un error acá se propaga a toda la lectura financiera.
 *
 * Cómo se derivan las bajas de este modelo de datos está en `membership.ts`.
 */

import { Rate, diasEntre } from './types';

/**
 * Porcentaje de la base que se da de baja dentro de un mes.
 *
 * Bajas del período sobre la base al INICIO del período — no sobre la base
 * promedio ni sobre la final, o las altas del mes diluirían el churn y lo harían
 * ver mejor de lo que es.
 *
 * Benchmark: 3–5% mensual es sano, por debajo de 3% es excepcional, por encima de
 * 7% pide una intervención de retención. Son rangos de EE.UU. y Europa: conviene
 * tratarlos como referencia configurable por gym, no como verdad local.
 */
export function monthlyChurnRate(input: {
  membersAtStart: number;
  cancelledDuringPeriod: number;
}): Rate | null {
  const { membersAtStart, cancelledDuringPeriod } = input;

  if (membersAtStart <= 0) {
    return null;
  }

  return cancelledDuringPeriod / membersAtStart;
}

/**
 * Qué proporción de los socios que había al inicio sigue siendo socio al final.
 *
 * Se **excluyen las altas nuevas** del período: sin eso, un mes de mucha
 * adquisición inflaría la retención y taparía la fuga. De ahí que la fórmula sea
 * `(socios al final − altas nuevas) / socios al inicio`.
 *
 * Benchmark anual: 70–80% es sano, por debajo de 60% es un balde con fugas. Ojo
 * con el segmento: boutique ronda 65–70%, bajo costo 55–60%, gama media 58–65%.
 */
export function retentionRate(input: {
  membersAtStart: number;
  membersAtEnd: number;
  newMembersInPeriod: number;
}): Rate | null {
  const { membersAtStart, membersAtEnd, newMembersInPeriod } = input;

  if (membersAtStart <= 0) {
    return null;
  }

  const retained = membersAtEnd - newMembersInPeriod;

  return retained / membersAtStart;
}

/**
 * Un socio de la cohorte. `cancelledAt` es su PRIMERA baja — la que devuelve
 * `firstChurnDate` en `membership.ts` —, no la última: para saber si sobrevivió a
 * sus primeros 90 días importa la primera vez que se fue.
 */
export interface CohortMember {
  readonly memberId: string;
  readonly joinedAt: Date;
  readonly cancelledAt: Date | null;
}

/**
 * De los socios que se dieron de alta en un mismo período, cuántos seguían activos
 * pasados N días desde SU alta.
 *
 * El churn agregado esconde el patrón; la cohorte lo revela. La ventana de 90 días
 * es la más accionable porque es la del onboarding: quien alcanza un hito temprano
 * en esos primeros 90 días tiene ~60% más de probabilidad de quedarse.
 *
 * `now` es opcional pero conviene pasarlo: sin él, un socio que se anotó hace 10
 * días cuenta como sobreviviente de la ventana de 90, y la cohorte joven se lee
 * como una retención perfecta que todavía no ocurrió. Con `now`, esos casos quedan
 * **censurados** — fuera del numerador y del denominador — hasta que su ventana
 * termine de transcurrir.
 */
export function cohortRetention(input: {
  cohort: ReadonlyArray<CohortMember>;
  windowDays: number;
  now?: Date;
}): Rate | null {
  const { cohort, windowDays, now } = input;

  const evaluables =
    now === undefined
      ? cohort
      : cohort.filter((m) => diasEntre(m.joinedAt, now) >= windowDays);

  if (evaluables.length === 0) {
    return null;
  }

  const survivors = evaluables.filter((m) => {
    if (m.cancelledAt === null) {
      return true; // nunca se fue
    }
    return diasEntre(m.joinedAt, m.cancelledAt) >= windowDays;
  }).length;

  return survivors / evaluables.length;
}

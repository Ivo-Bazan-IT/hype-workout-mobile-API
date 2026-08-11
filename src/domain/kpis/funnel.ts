/**
 * Adquisición y embudo — indicadores adelantados.
 *
 * Predicen el ingreso con semanas de anticipación: los leads preceden a las
 * pruebas, las pruebas a las altas y las altas al ingreso. Cuando el MRR cae, la
 * causa suele estar acá y ser de hace dos meses.
 *
 * **Qué es un lead en este CRM.** No hay entidad separada: un `Client` sin encuesta
 * completada es un lead — llegó por el formulario pero no confirmó nada. Cuando la
 * encuesta se llena, ese mismo registro pasa a ser socio. La conversión es
 * exactamente ese salto.
 *
 * Los dos timestamps que esto necesita —`fechaConversion` y `fechaPrimerContacto`—
 * viven en `Client` desde la tanda 4. `updatedAt` no servía para ninguno de los dos:
 * lo pisa cualquier edición posterior, así que una corrección de teléfono habría
 * movido la conversión de mes.
 */

import { DIAS_POR_SEMANA, MS_POR_MINUTO, Rate, diasEntre } from './types';

/**
 * Prospectos nuevos por semana.
 *
 * El indicador más adelantado de todos: si los leads caen esta semana, el ingreso
 * cae en 6 a 10 semanas. Benchmark boutique: 5–15 por semana.
 */
export function newLeadsPerWeek(input: {
  leadsInPeriod: number;
  periodDays: number;
}): number | null {
  const { leadsInPeriod, periodDays } = input;

  if (periodDays <= 0) {
    return null;
  }

  return leadsInPeriod / (periodDays / DIAS_POR_SEMANA);
}

/**
 * Qué proporción de los leads termina siendo socio que paga. Mide la efectividad
 * del proceso comercial; benchmark sano para consultas web o walk-ins: 30–50%.
 *
 * Definir bien la ventana es la mitad del trabajo (típicamente 90 días desde la
 * creación del lead): sin ella, los leads que todavía están en proceso se cuentan
 * como no convertidos y la tasa se lee peor de lo que es.
 */
export function leadConversionRate(input: {
  convertedMembers: number;
  totalLeads: number;
}): Rate | null {
  const { convertedMembers, totalLeads } = input;

  if (totalLeads <= 0) {
    return null;
  }

  return convertedMembers / totalLeads;
}

/**
 * Un prospecto que entró al embudo, tal como lo materializa el puerto de métricas.
 *
 * `convertido` NO se deriva de `fechaConversion`: los clientes que contestaron la
 * encuesta antes de que existiera el campo convirtieron de verdad, pero en una fecha
 * que nadie registró. Se los cuenta como convertidos —lo son— con `fechaConversion`
 * en `null`, y por eso ningún período se los puede imputar. Es la misma regla de
 * "nada estimado" que rige el resto del tablero.
 */
export interface LeadRecord {
  readonly clientId: string;
  /** Cuándo entró al embudo. Es el alta del `Client`. */
  readonly createdAt: Date;
  readonly fechaPrimerContacto: Date | null;
  readonly fechaConversion: Date | null;
  readonly convertido: boolean;
}

/**
 * Conversión de la cohorte que ya tuvo su ventana completa para convertir.
 *
 * Sin la censura, el embudo del mes en curso se lee siempre mal: los leads de ayer
 * todavía no tuvieron tiempo de contestar la encuesta y entrarían al denominador
 * como fracasos. Por eso solo se evalúan los leads con al menos `windowDays` de
 * antigüedad —los más nuevos quedan fuera del numerador Y del denominador— igual que
 * hace `cohortRetention` en `retention.ts`.
 *
 * Consecuencia esperable: para el período por defecto (el mes en curso) esto devuelve
 * `null` casi siempre, porque con una ventana de 90 días ningún lead del mes maduró.
 * No es una falla — es el motivo por el que el bloque expone además los conteos
 * crudos de leads y conversiones, que sí son dato real de todos los días.
 */
export function cohortConversionRate(input: {
  leads: ReadonlyArray<LeadRecord>;
  windowDays: number;
  now: Date;
}): Rate | null {
  const { leads, windowDays, now } = input;

  const evaluables = leads.filter((l) => diasEntre(l.createdAt, now) >= windowDays);

  return leadConversionRate({
    convertedMembers: evaluables.filter((l) => l.convertido).length,
    totalLeads: evaluables.length,
  });
}

export interface LeadContact {
  readonly createdAt: Date;
  readonly firstContactedAt: Date | null;
}

/**
 * Minutos promedio hasta el primer contacto con un lead nuevo.
 *
 * Es una de las palancas más baratas del embudo: impacta la conversión sin costar
 * plata. Se promedia solo sobre los leads efectivamente contactados — los que nunca
 * se contactaron son un problema de cobertura, no de velocidad, y meterlos acá
 * mezclaría dos diagnósticos con acciones distintas.
 */
export function avgLeadResponseMinutes(
  leads: ReadonlyArray<LeadContact>
): number | null {
  const contactados = leads.filter((l) => l.firstContactedAt !== null);

  if (contactados.length === 0) {
    return null;
  }

  const minutosTotales = contactados.reduce(
    (sum, l) => sum + (l.firstContactedAt!.getTime() - l.createdAt.getTime()) / MS_POR_MINUTO,
    0
  );

  return minutosTotales / contactados.length;
}

/** Conversión global de pruebas a membresía paga. */
export function trialConversionRate(input: {
  convertedTrials: number;
  totalTrials: number;
}): Rate | null {
  const { convertedTrials, totalTrials } = input;

  if (totalTrials <= 0) {
    return null;
  }

  return convertedTrials / totalTrials;
}

export interface TrialOutcome {
  readonly visitsDuringTrial: number;
  readonly converted: boolean;
}

/**
 * Conversión de los trials con al menos `minVisits` visitas.
 *
 * Acá está el dato accionable que la conversión global esconde: asistir 3+ veces
 * durante la prueba **duplica** la probabilidad de conversión. Segmentar por
 * visitas expone el umbral y le dice al CRM a qué trials empujar y cuándo.
 */
export function trialConversionByVisits(
  trials: ReadonlyArray<TrialOutcome>,
  minVisits: number
): Rate | null {
  const segmento = trials.filter((t) => t.visitsDuringTrial >= minVisits);

  if (segmento.length === 0) {
    return null;
  }

  const convertidos = segmento.filter((t) => t.converted).length;

  return convertidos / segmento.length;
}

/**
 * Altas menos bajas. Un gimnasio que suma 8 y pierde 8 no crece, y el conteo bruto
 * de altas lo esconde: se muestra explícito para que el estancamiento se vea.
 */
export function netMemberGrowth(input: {
  newMembers: number;
  churnedMembers: number;
}): number {
  return input.newMembers - input.churnedMembers;
}

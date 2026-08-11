/**
 * KPIs financieros.
 *
 * Todos los montos entran y salen en **centavos enteros** (`Cents`). La base guarda
 * pesos, así que la conversión ×100 la hace el adaptador al leer: acá adentro no se
 * asume ninguna otra unidad.
 *
 * **Fuera de alcance por ahora, a pedido:** CAC, ratio LTV:CAC y payback de CAC.
 * Los tres necesitan el gasto de ventas y marketing del período, un dato que no
 * existe en ninguna entidad y que exige modelar el flujo de trabajo de cada gym.
 * Por el mismo motivo el margen bruto no se calcula: `lifetimeValue` acepta el
 * parámetro pero, mientras no se pase, devuelve LTV sobre INGRESO y no sobre
 * beneficio — que es una lectura distinta y conviene rotularla como tal en el
 * dashboard.
 */

import { Cents, DIAS_POR_MES, Rate, diasEntre } from './types';

/**
 * Lleva el monto de una ventana de membresía a base mensual.
 *
 * Es lo que hace calculable el MRR sin necesidad de una entidad `Plan`: la "cuota"
 * de un socio es lo que pagó dividido por lo que duró esa ventana. Un pago
 * trimestral de $30.000 entra al MRR como $10.000, no como $30.000 de un mes.
 *
 * Devuelve `null` si la ventana no tiene duración positiva: sin días no hay cuota
 * mensual que derivar, y dividir por cero acá metería un `Infinity` en el MRR.
 */
export function normalizeToMonthlyFee(input: {
  monto: Cents;
  inicio: Date;
  vencimiento: Date;
}): Cents | null {
  const { monto, inicio, vencimiento } = input;

  const dias = diasEntre(inicio, vencimiento);
  if (dias <= 0) {
    return null;
  }

  const meses = dias / DIAS_POR_MES;

  return Math.round(monto / meses);
}

/**
 * MRR total: suma de las cuotas recurrentes activas ya normalizadas a base mensual
 * (ver `normalizeToMonthlyFee`).
 */
export function mrr(
  activeSubscriptions: ReadonlyArray<{ monthlyFee: Cents }>
): Cents {
  return activeSubscriptions.reduce((sum, s) => sum + s.monthlyFee, 0);
}

/**
 * Descomposición del movimiento de MRR del período. Es lo que convierte un número
 * en un diagnóstico: dice si el crecimiento vino de adquirir, de hacer upsell o de
 * apenas tapar las bajas.
 */
export interface MrrMovement {
  /** Altas nuevas. */
  readonly newMrr: Cents;
  /** Upgrades y reactivaciones — el socio que se había ido y volvió entra acá. */
  readonly expansionMrr: Cents;
  /** Downgrades. */
  readonly contractionMrr: Cents;
  /** Bajas. */
  readonly churnedMrr: Cents;
}

/** Variación neta de MRR en el período. */
export function netMrrGrowth(m: MrrMovement): Cents {
  return m.newMrr + m.expansionMrr - m.contractionMrr - m.churnedMrr;
}

/**
 * Ingreso mensual promedio por socio.
 *
 * Si `monthlyRevenue` trae solo cuotas, esto es ARPU. Si además suma extras
 * (entrenamiento personal, retail, pases diarios), es ARPM, y la diferencia entre
 * ambos mide cuánto se está diversificando el ingreso más allá de la membresía.
 */
export function arpu(input: {
  monthlyRevenue: Cents;
  activeMembers: number;
}): Cents | null {
  const { monthlyRevenue, activeMembers } = input;

  if (activeMembers <= 0) {
    return null;
  }

  return Math.round(monthlyRevenue / activeMembers);
}

/**
 * Valor de vida del socio: cuánto aporta a lo largo de toda su relación con el gym.
 *
 * La vida media de un socio es `1 / churn mensual`, así que
 * `LTV = ARPU × margen / churn`. El insight que justifica todo el trabajo de
 * retención está en ese denominador: **reducir el churn a la mitad duplica el LTV**.
 *
 * Con churn 0 el LTV tiende a infinito, así que devuelve `null`: un gym sin bajas
 * en el período no tiene LTV calculable, tiene una muestra demasiado chica.
 */
export function lifetimeValue(input: {
  arpu: Cents;
  monthlyChurnRate: Rate;
  /** [0,1]. Por defecto 1: el resultado es LTV sobre ingreso, no sobre beneficio. */
  grossMargin?: Rate;
}): Cents | null {
  const { arpu: arpuValue, monthlyChurnRate } = input;
  const grossMargin = input.grossMargin ?? 1;

  if (monthlyChurnRate <= 0) {
    return null;
  }

  return Math.round((arpuValue * grossMargin) / monthlyChurnRate);
}

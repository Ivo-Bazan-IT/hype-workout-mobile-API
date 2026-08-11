/**
 * Agregados de un período sobre el historial de membresía del gym.
 *
 * Son las cinco cuentas que `/dashboard/kpis` y `/dashboard/kpis/series` hacen
 * exactamente igual: ingresos, MRR, altas, bajas y socios activos. Vivían como
 * métodos privados de `GetGymKpisUseCase`, y en cuanto apareció un segundo
 * consumidor —la serie mensual, que las repite doce veces— quedaron acá.
 *
 * El motivo es el mismo que da `IMetricsRepository` para materializar el historial
 * en vez de agregarlo en Mongo: la regla que define quién es socio vive en un solo
 * archivo. Duplicar el cálculo del MRR en un segundo caso de uso es la forma
 * silenciosa de que dos pantallas muestren números distintos y nadie sepa cuál creer.
 *
 * Dominio puro, como todo `domain/kpis/`: recibe datos ya materializados y el
 * instante como parámetro, no hace I/O y no lee el reloj.
 */

import { ClientMembershipHistory } from '../repositories/IMetricsRepository';
import { mrr, normalizeToMonthlyFee } from './financial';
import { churnedDuring, isActiveAt, windowAt } from './membership';
import { Cents, DateRange } from './types';

/** Rango semiabierto `[start, end)`, la convención de todo el dominio. */
const dentroDe = (fecha: Date, rango: DateRange): boolean => {
  const t = fecha.getTime();
  return t >= rango.start.getTime() && t < rango.end.getTime();
};

/**
 * Todo lo cobrado en el período.
 *
 * Sale de `pagos` y no de `windows[].monto`: los dos se solapan, y las renovaciones
 * históricas sin vencimiento conocido aparecen en `pagos` pero no dibujan ventana.
 * Sumar desde las ventanas perdería ingresos reales; sumar desde ambos los contaría
 * dos veces.
 */
export function revenueIn(
  historiales: ReadonlyArray<ClientMembershipHistory>,
  rango: DateRange
): Cents {
  return historiales.reduce(
    (total, h) =>
      total +
      h.pagos.filter((p) => dentroDe(p.fecha, rango)).reduce((sub, p) => sub + p.monto, 0),
    0
  );
}

/**
 * Altas del período.
 *
 * Es dato real incluso antes del corte de datos completos, porque sale de la fecha
 * del primer evento del socio y no de reconstruir ventanas. Por eso `altas` viaja
 * como número en meses en los que `bajas` viaja como `null`.
 */
export function newMembersIn(
  historiales: ReadonlyArray<ClientMembershipHistory>,
  rango: DateRange
): number {
  return historiales.filter((h) => dentroDe(h.fechaAlta, rango)).length;
}

/**
 * Bajas firmes caídas dentro del período.
 *
 * Solo tiene sentido a partir del corte de datos completos: antes de esa fecha las
 * renovaciones no registraron vencimiento, así que no dibujan ventana y una baja
 * que existió sería invisible. Quien llama decide si el período es confiable — esta
 * función no lo sabe y por eso no devuelve `null`.
 */
export function churnedMembersIn(
  historiales: ReadonlyArray<ClientMembershipHistory>,
  rango: DateRange
): number {
  return historiales.filter((h) => churnedDuring(h.windows, rango)).length;
}

/** Socios que contaban como tales en ese instante puntual (incluye los en gracia). */
export function activeMembersAt(
  historiales: ReadonlyArray<ClientMembershipHistory>,
  at: Date
): number {
  return historiales.filter((h) => isActiveAt(h.windows, at)).length;
}

/**
 * MRR en un instante: la cuota vigente de cada socio activo, normalizada a base
 * mensual.
 *
 * Un socio sin monto conocido en su ventana vigente queda afuera del cálculo en vez
 * de contarse como cero: no saber cuánto paga no es lo mismo que saber que no paga.
 */
export function mrrAt(
  historiales: ReadonlyArray<ClientMembershipHistory>,
  at: Date
): Cents {
  const cuotas = historiales
    .filter((h) => isActiveAt(h.windows, at))
    .map((h) => windowAt(h.windows, at))
    .flatMap((ventana) => {
      if (ventana === null || ventana.monto === null) {
        return [];
      }

      const cuota = normalizeToMonthlyFee({
        monto: ventana.monto,
        inicio: ventana.inicio,
        vencimiento: ventana.vencimiento,
      });

      return cuota === null ? [] : [{ monthlyFee: cuota }];
    });

  return mrr(cuotas);
}

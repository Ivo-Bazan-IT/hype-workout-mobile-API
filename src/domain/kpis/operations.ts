/**
 * Operaciones y capacidad.
 *
 * El overhead de un gimnasio es fijo: el alquiler y los equipos cuestan lo mismo
 * con la sala llena o vacía. Por eso estas métricas tocan el margen de forma más
 * directa que cualquier otra — no mueven el ingreso, mueven cuánto de ese ingreso
 * queda.
 */

import { Rate } from './types';

/**
 * Fracción de la capacidad disponible que se está usando, típicamente medida en
 * horas pico (6–9 AM y 5–8 PM).
 *
 * Por encima de 60–70% en pico puede pedir expansión; por debajo de 40% hay
 * capacidad ociosa que conviene llenar con programación nueva —o recortar—. El
 * promedio del día completo no sirve para esto: siempre da bajo y esconde el
 * problema real, que es la franja en la que la gente efectivamente va.
 */
export function facilityUtilizationRate(input: {
  slotsUsed: number;
  slotsAvailable: number;
}): Rate | null {
  const { slotsUsed, slotsAvailable } = input;

  if (slotsAvailable <= 0) {
    return null;
  }

  return slotsUsed / slotsAvailable;
}

export interface ClassSession {
  readonly attendees: number;
  readonly capacity: number;
}

/**
 * Qué porcentaje de los cupos de clase se llena, **ponderado por capacidad**.
 *
 * La ponderación no es un detalle: un promedio simple de porcentajes hace que una
 * clase de 4 cupos llena compense a una de 30 cupos vacía, cuando en plata pasó lo
 * contrario. Sumar cupos y asistentes por separado le da a cada clase el peso que
 * realmente tiene.
 *
 * Un horario lleno de forma consistente justifica duplicar la sesión; uno vacío se
 * está comiendo margen.
 */
export function classOccupancyRate(
  sessions: ReadonlyArray<ClassSession>
): Rate | null {
  const capacidadTotal = sessions.reduce((s, c) => s + c.capacity, 0);

  if (capacidadTotal <= 0) {
    return null;
  }

  const asistentesTotales = sessions.reduce((s, c) => s + c.attendees, 0);

  return asistentesTotales / capacidadTotal;
}

/**
 * Qué proporción de las reservas no se cumple.
 *
 * Cada no-show es capacidad desperdiciada y, además, una señal de a quién hacer
 * seguimiento. Los patrones por horario (el PT de la tarde falta más que el de la
 * mañana) son los que permiten ajustar la política de reservas.
 */
export function noShowRate(input: {
  noShows: number;
  totalBookings: number;
}): Rate | null {
  const { noShows, totalBookings } = input;

  if (totalBookings <= 0) {
    return null;
  }

  return noShows / totalBookings;
}

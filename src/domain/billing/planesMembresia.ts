/**
 * Cuándo vence una membresía renovada.
 *
 * Mismo espíritu que `domain/routine/vigencia.ts`: es una regla del negocio, no un
 * detalle del caso de uso que la usa.
 *
 * Ancla en el mayor entre HOY y el vencimiento actual: un socio vencido que renueva
 * arranca de hoy (no arrastra el tiempo que estuvo sin pagar), y uno que renueva
 * antes de vencer extiende desde su vencimiento real (no pierde los días que le
 * quedaban).
 */
export const calcularNuevoVencimiento = (vencimientoActual: Date, duracionDias: number): Date => {
  const ahora = new Date();
  const base = vencimientoActual > ahora ? vencimientoActual : ahora;

  const nueva = new Date(base);
  nueva.setDate(nueva.getDate() + duracionDias);
  return nueva;
};

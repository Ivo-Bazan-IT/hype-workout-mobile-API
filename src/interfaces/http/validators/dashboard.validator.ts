import { z } from 'zod';

/**
 * Período de consulta de los KPIs. Si no se manda nada, el caso de uso usa el mes
 * calendario en curso.
 *
 * Se exigen juntos a propósito: un `desde` suelto tendría que asumir un `hasta`, y
 * un rango asumido es justo lo que hace que dos pantallas muestren números
 * distintos y nadie sepa cuál creer.
 */
export const gymKpisQuerySchema = z
  .object({
    desde: z.coerce.date().optional(),
    hasta: z.coerce.date().optional(),
  })
  .refine((q) => (q.desde === undefined) === (q.hasta === undefined), {
    message: 'desde y hasta deben enviarse juntos',
  });

/**
 * Cuántos meses de historia devuelve la serie mensual.
 *
 * El techo de 24 no es defensivo por reflejo: cada mes es un recorrido completo del
 * historial del gym en memoria, así que el costo crece lineal con este número. El
 * front nunca pide más de 12, y 24 deja margen para una comparación interanual sin
 * abrir la puerta a un `?meses=100000`.
 */
export const gymKpisSeriesQuerySchema = z.object({
  meses: z.coerce.number().int().positive().max(24).default(12),
});

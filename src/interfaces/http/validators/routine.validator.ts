import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id format');

/**
 * Filtros del listado de rutinas. Las fechas llegan como string en la query y se
 * convierten acá, en el borde, para que el caso de uso reciba `Date`.
 *
 * `gymId` se declara opcional porque el super-admin lo usa para elegir tenant: sin
 * declararlo, `validateQuery` lo descartaría al reemplazar `req.query` con el
 * resultado del parse, y `tenantMiddleware` respondería 400 a un request que sí lo
 * mandó.
 */
export const searchRoutinesSchema = z.object({
  gymId: objectId.optional(),
  clientId: objectId.optional(),
  estadoEnvio: z.enum(['pendiente', 'enviando', 'enviado', 'error']).optional(),
  estadoGeneracion: z.enum(['pendiente', 'generando', 'generado', 'error']).optional(),
  vencimientoDesde: z.coerce.date({ invalid_type_error: 'vencimientoDesde inválida' }).optional(),
  vencimientoHasta: z.coerce.date({ invalid_type_error: 'vencimientoHasta inválida' }).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id format');

/**
 * Filtros del historial de facturación. Las fechas llegan como string en la query
 * y se convierten acá, en el borde, para que el caso de uso reciba `Date`.
 *
 * `gymId` se declara opcional porque el super-admin lo usa para elegir tenant: sin
 * declararlo, `validateQuery` lo descartaría al reemplazar `req.query` con el
 * resultado del parse.
 */
export const searchInvoicesSchema = z.object({
  gymId: objectId.optional(),
  clientId: objectId.optional(),
  estado: z.enum(['emitida', 'anulada', 'error', 'pendiente']).optional(),
  tipoComprobante: z.string().min(1).optional(),
  cae: z.string().min(1).optional(),
  emitidaDesde: z.coerce.date({ invalid_type_error: 'emitidaDesde inválida' }).optional(),
  emitidaHasta: z.coerce.date({ invalid_type_error: 'emitidaHasta inválida' }).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const revenueReportSchema = z.object({
  gymId: objectId.optional(),
  desde: z.coerce.date({ invalid_type_error: 'desde inválida' }).optional(),
  hasta: z.coerce.date({ invalid_type_error: 'hasta inválida' }).optional(),
});

import { z } from 'zod';
import { AI_PROVIDERS } from '../../../domain/entities/Gym';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id format');

/**
 * `gymId` se declara opcional porque el super-admin lo usa para elegir tenant: sin
 * declararlo, `validateQuery` lo descartaría al reemplazar `req.query` con el
 * resultado del parse.
 */
export const searchAiUsageSchema = z.object({
  gymId: objectId.optional(),
  clientId: objectId.optional(),
  routineId: objectId.optional(),
  provider: z.enum(AI_PROVIDERS).optional(),
  model: z.string().min(1).optional(),
  desde: z.coerce.date({ invalid_type_error: 'desde inválida' }).optional(),
  hasta: z.coerce.date({ invalid_type_error: 'hasta inválida' }).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const aiUsageReportSchema = z.object({
  gymId: objectId.optional(),
  desde: z.coerce.date({ invalid_type_error: 'desde inválida' }).optional(),
  hasta: z.coerce.date({ invalid_type_error: 'hasta inválida' }).optional(),
});

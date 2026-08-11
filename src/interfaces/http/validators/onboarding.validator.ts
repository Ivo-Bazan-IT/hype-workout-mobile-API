import { z } from 'zod';

/**
 * Body del webhook de Google Forms. Es un endpoint PÚBLICO, así que valida antes de
 * que nada toque la base: sin esto un `gymId` basura llegaba hasta Mongoose y
 * terminaba en un CastError.
 */
export const formWebhookSchema = z.object({
  gymId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'gymId must be a valid id'),
  respuestas: z
    .record(z.any())
    .refine((respuestas) => Object.keys(respuestas).length > 0, {
      message: 'respuestas cannot be empty',
    }),
  // Clave de idempotencia. Opcional porque el trigger instalado sobre la hoja de
  // respuestas no lo tiene: sin él la submission se procesa igual, pero un reenvío
  // se vuelve a aplicar. No se valida el formato — lo genera Google y no es nuestro.
  responseId: z.string().min(1).optional(),
});

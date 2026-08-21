import { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { env } from '../../../config/env';

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

/**
 * Compara en tiempo constante, sin filtrar la longitud del secreto.
 *
 * `timingSafeEqual` **lanza** si los buffers miden distinto, así que comparar los
 * largos primero y salir antes convertiría el propio error en un oráculo: quien
 * probara secretos podría deducir el largo por el tiempo de respuesta. Se hashea
 * a un tamaño fijo para que la comparación siempre corra sobre 32 bytes.
 */
const igualEnTiempoConstante = (a: string, b: string): boolean => {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
};

/**
 * Puerta de los disparadores internos (cron externo, healthchecks de trabajo).
 *
 * No usa `authMiddleware`: del otro lado no hay un usuario con JWT ni un tenant,
 * es una máquina llamando a una tarea que opera sobre TODOS los gimnasios. Por eso
 * tampoco puede colgar de `tenantMiddleware`.
 *
 * El secreto es global y estático, distinto del `webhookSecret` por-gym del
 * onboarding: aquel identifica a qué gimnasio pertenece una submission, este solo
 * dice "el que llama es nuestro cron".
 */
export const internalAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const configurado = env.INVOICE_CRON_SECRET;

  // Sin secreto no se degrada a "abierto": se cierra. Un gatillo de emisión de
  // comprobantes ante AFIP accesible sin credencial es peor que uno caído.
  if (!configurado) {
    res.status(503).json({
      status: 'error',
      message: 'Internal job trigger is not configured'
    });
    return;
  }

  const recibido = req.header(INTERNAL_SECRET_HEADER);

  if (!recibido || !igualEnTiempoConstante(recibido, configurado)) {
    // Sin detalle del motivo: que falte el header o que no coincida es la misma
    // respuesta para quien está probando.
    res.status(401).json({
      status: 'error',
      message: 'Invalid internal secret'
    });
    return;
  }

  next();
};

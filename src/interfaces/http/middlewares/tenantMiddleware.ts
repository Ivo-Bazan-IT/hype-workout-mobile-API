import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { ForbiddenError, ValidationError } from '../../../shared/errors/AppError';

/**
 * Resuelve el tenant (gymId) de la petición y lo deja en `req.tenantId`.
 *
 * Es el ÚNICO lugar donde se decide sobre qué gym opera un request. Antes cada
 * handler re-derivaba el gymId de `req.user` por su cuenta (~19 copias del mismo
 * bloque) y las copias ya habían divergido: unas soportaban `?gymId=` de admin,
 * otras solo `user.gymId`, y RoutineController llegaba a consultar con gymId `''`.
 *
 * Reglas:
 *  - rol `gym`: siempre su propio gymId del JWT. No puede operar otro tenant.
 *  - rol `admin`: opera cualquier gym pasando `?gymId=`. Sin ese parámetro no hay
 *    tenant que resolver y se rechaza con 400: el super-admin no tiene gym propio,
 *    y adivinar uno sería peor que fallar.
 */
export const tenantMiddleware = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  const user = req.user;

  if (!user) {
    throw new ForbiddenError('User not authenticated');
  }

  if (user.role === 'admin') {
    const queryGymId = req.query.gymId as string | undefined;

    if (!queryGymId) {
      throw new ValidationError('gymId query parameter is required for admin users');
    }

    req.tenantId = queryGymId;
    return next();
  }

  if (user.role === 'gym' && user.gymId) {
    req.tenantId = user.gymId;
    return next();
  }

  throw new ForbiddenError('Gym access required');
};

/**
 * Lee el tenant ya resuelto por `tenantMiddleware`.
 *
 * Lanza si la ruta olvidó montar el middleware, para que ese olvido se manifieste
 * como un 403 explícito y nunca como una query sin filtrar por gym (que sería una
 * fuga de datos entre tenants).
 */
export const getTenantId = (req: AuthenticatedRequest): string => {
  if (!req.tenantId) {
    throw new ForbiddenError('Gym access required');
  }

  return req.tenantId;
};

// Extendemos el Request para incluir tenantId
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

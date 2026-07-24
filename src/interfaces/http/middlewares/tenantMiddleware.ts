import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { ForbiddenError } from '../../../shared/errors/AppError';

export const tenantMiddleware = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  const user = req.user;

  if (!user) {
    throw new ForbiddenError('User not authenticated');
  }

  // Admin puede pasar gymId por query param
  if (user.role === 'admin') {
    const queryGymId = req.query.gymId as string | undefined;
    req.tenantId = queryGymId || null;
    return next();
  }

  // Usuario gym siempre tiene su gymId fijo del JWT
  if (user.role === 'gym' && user.gymId) {
    req.tenantId = user.gymId;
    return next();
  }

  throw new ForbiddenError('Gym access required');
};

// Extendemos el Request para incluir tenantId
declare global {
  namespace Express {
    interface Request {
      tenantId: string | null;
    }
  }
}
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { ForbiddenError } from '../../../shared/errors/AppError';

export const requireAdmin = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  const user = req.user;

  if (!user || user.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }

  next();
};

export const requireGym = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  const user = req.user;

  if (!user || user.role !== 'entrenador') {
    throw new ForbiddenError('Gym access required');
  }

  next();
};

export const requireAuth = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  next();
};
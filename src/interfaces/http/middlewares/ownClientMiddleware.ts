import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { NotFoundError } from '../../../shared/errors/AppError';

export const ownClientMiddleware = async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== 'cliente') {
    return next();
  }

  try {
    const clientRepo = new MongoClientRepository();
    // Usar el gymId resuelto por tenantMiddleware (entrenadorId del cliente)
    const tenantId = (req as any).tenantId || user.entrenadorId;
    if (!tenantId) {
      return next();
    }

    const client = await clientRepo.findByUserId(user.userId, tenantId);
    if (!client) {
      throw new NotFoundError('Client');
    }
    (req as any).ownClientId = client.id;
    next();
  } catch (err) {
    next(err);
  }
};

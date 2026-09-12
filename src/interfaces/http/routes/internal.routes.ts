import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { InternalJobsController } from '../controllers/InternalJobsController';
import { internalAuthMiddleware } from '../middlewares/internalAuthMiddleware';
import { CheckWeeklyUpdatesUseCase } from '../../../application/use-cases/internal/CheckWeeklyUpdatesUseCase';
import { NoOpNotificationProvider } from '../../../infrastructure/external/notifications/NoOpNotificationProvider';
import { MongoProgressUpdateRepository } from '../../../infrastructure/database/mongoose/repositories/MongoProgressUpdateRepository';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { EmitPendingInvoicesUseCase } from '../../../application/use-cases/invoice/EmitPendingInvoicesUseCase';
import { MongoInvoiceRepository } from '../../../infrastructure/database/mongoose/repositories/MongoInvoiceRepository';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoGymSecretsRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymSecretsRepository';
import { EncryptionService } from '../../../infrastructure/encryption/EncryptionService';
import { AfipSdkAdapterFactory } from '../../../infrastructure/external/billing/AfipSdkAdapterFactory';
import { AfipSdkOwnAccountAdapterFactory } from '../../../infrastructure/external/billing/AfipSdkOwnAccountAdapterFactory';

/**
 * Rutas internas: las llama nuestra propia infraestructura, no un usuario ni un
 * tercero. Van montadas ANTES del `authMiddleware` global porque un cron no tiene
 * JWT, y su puerta es `internalAuthMiddleware`.
 */
const createInternalRouter = (): Router => {
  const router = Router();

  const emitPendingInvoices = new EmitPendingInvoicesUseCase(
    new MongoInvoiceRepository(),
    new MongoGymRepository(),
    new MongoGymSecretsRepository(new EncryptionService()),
    new MongoClientRepository(),
    new AfipSdkOwnAccountAdapterFactory(),
    new AfipSdkAdapterFactory()
  );

  const progressRepo = new MongoProgressUpdateRepository();
  const clientRepo = new MongoClientRepository();
  const notificationProvider = new NoOpNotificationProvider();
  const checkWeeklyUpdates = new CheckWeeklyUpdatesUseCase(progressRepo, clientRepo, notificationProvider);

  const controller = new InternalJobsController(emitPendingInvoices, checkWeeklyUpdates);

  // Más laxo que el de /auth: un cron legítimo golpea seguido y desde una IP fija.
  // Está para acotar el costo de que alguien encuentre la ruta, no para el uso normal.
  const internalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many internal job requests',
  });

  router.post('/jobs/check-weekly-updates', internalLimiter, internalAuthMiddleware, (req, res, next) =>
    controller.checkWeeklyUpdates(req, res, next)
  );

  router.post('/jobs/emit-invoices', internalLimiter, internalAuthMiddleware, (req, res, next) =>
    controller.emitInvoices(req, res, next)
  );

  return router;
};

export const internalRoutes = createInternalRouter();

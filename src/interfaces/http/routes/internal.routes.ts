import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { InternalJobsController } from '../controllers/InternalJobsController';
import { internalAuthMiddleware } from '../middlewares/internalAuthMiddleware';
import { EmitPendingInvoicesUseCase } from '../../../application/use-cases/invoice/EmitPendingInvoicesUseCase';
import { MongoInvoiceRepository } from '../../../infrastructure/database/mongoose/repositories/MongoInvoiceRepository';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoGymSecretsRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymSecretsRepository';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
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

  const controller = new InternalJobsController(emitPendingInvoices);

  // Más laxo que el de /auth: un cron legítimo golpea seguido y desde una IP fija.
  // Está para acotar el costo de que alguien encuentre la ruta, no para el uso normal.
  const internalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many internal job requests',
  });

  router.post('/jobs/emit-invoices', internalLimiter, internalAuthMiddleware, (req, res, next) =>
    controller.emitInvoices(req, res, next)
  );

  return router;
};

export const internalRoutes = createInternalRouter();

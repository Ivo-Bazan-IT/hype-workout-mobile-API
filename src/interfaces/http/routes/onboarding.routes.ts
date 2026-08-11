import { Router } from 'express';
import { OnboardingController } from '../controllers/OnboardingController';
import { ProcessFormSubmissionUseCase } from '../../../application/use-cases/onboarding/ProcessFormSubmissionUseCase';
import { GetOnboardingStatusUseCase } from '../../../application/use-cases/onboarding/GetOnboardingStatusUseCase';
import { GoogleFormsWebhookHandler } from '../../../infrastructure/external/forms/GoogleFormsWebhookHandler';
import { BcryptWebhookSecretService } from '../../../infrastructure/encryption/BcryptWebhookSecretService';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoFormSubmissionRecordRepository } from '../../../infrastructure/database/mongoose/repositories/MongoFormSubmissionRecordRepository';
import { formWebhookSchema } from '../validators/onboarding.validator';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';

/**
 * El onboarding tiene dos superficies con requisitos opuestos, y por eso son dos
 * routers en vez de uno:
 *
 *  - `POST /webhook` es **público**: lo llama Google, que no tiene JWT. Se autentica
 *    con el secreto propio del gym.
 *  - `GET /status` son **datos del tenant** (qué submissions llegaron, cuáles
 *    rebotaron y con qué DNI). Antes vivía en el router público, montado antes del
 *    `authMiddleware` pese al comentario que decía "requiere auth": cualquiera podía
 *    consultarlo.
 */
const construirController = (): OnboardingController => {
  const clientRepository = new MongoClientRepository();
  const gymRepository = new MongoGymRepository();
  const submissionRecordRepository = new MongoFormSubmissionRecordRepository();
  const webhookSecretService = new BcryptWebhookSecretService();
  const formsHandler = new GoogleFormsWebhookHandler(gymRepository, webhookSecretService);

  const processFormUseCase = new ProcessFormSubmissionUseCase(
    clientRepository,
    gymRepository,
    submissionRecordRepository
  );

  const getOnboardingStatusUseCase = new GetOnboardingStatusUseCase(
    gymRepository,
    submissionRecordRepository
  );

  return new OnboardingController(
    processFormUseCase,
    formsHandler,
    getOnboardingStatusUseCase
  );
};

const createOnboardingRouter = (): Router => {
  const router = Router();
  const onboardingController = construirController();

  // Rate limiting para prevenir spam
  const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por IP
    message: 'Too many requests',
  });

  // Webhook público (validado por el webhookSecret propio de cada gym)
  router.post('/webhook', webhookLimiter, validateBody(formWebhookSchema), (req, res, next) =>
    onboardingController.webhook(req, res, next)
  );

  return router;
};

const createOnboardingStatusRouter = (): Router => {
  const router = Router();
  const onboardingController = construirController();

  // GET /api/onboarding/status - Estado real de la integración del tenant.
  router.get('/status', (req, res, next) =>
    onboardingController.status(req as AuthenticatedRequest, res, next)
  );

  return router;
};

// Middleware para validar body con Zod
function validateBody(schema: z.ZodSchema<any>) {
  return (req: any, _res: any, next: any) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const onboardingRoutes = createOnboardingRouter();
export const onboardingStatusRoutes = createOnboardingStatusRouter();

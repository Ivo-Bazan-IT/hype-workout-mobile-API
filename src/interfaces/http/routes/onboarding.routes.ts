import { Router } from 'express';
import { OnboardingController } from '../controllers/OnboardingController';
import { ProcessFormSubmissionUseCase } from '../../../application/use-cases/onboarding/ProcessFormSubmissionUseCase';
import { GoogleFormsWebhookHandler } from '../../../infrastructure/external/forms/GoogleFormsWebhookHandler';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import rateLimit from 'express-rate-limit';

const createOnboardingRouter = () => {
  const router = Router();

  const clientRepository = new MongoClientRepository();
  const gymRepository = new MongoGymRepository();
  const formsHandler = new GoogleFormsWebhookHandler(gymRepository);

  const processFormUseCase = new ProcessFormSubmissionUseCase(
    clientRepository,
    gymRepository
  );

  const onboardingController = new OnboardingController(
    processFormUseCase,
    formsHandler
  );

  // Rate limiting para prevenir spam
  const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por IP
    message: 'Too many requests',
  });

  // Webhook público (validado por webhookSecret)
  router.post('/webhook', webhookLimiter, (req, res, next) =>
    onboardingController.webhook(req, res, next)
  );

  // Status - requiere auth
  router.get('/status', (req, res, next) =>
    onboardingController.status(req, res, next)
  );

  return router;
};

export const onboardingRoutes = createOnboardingRouter();
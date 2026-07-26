import { Router } from 'express';
import { GymController } from '../controllers/GymController';
import { CreateGymUseCase } from '../../../application/use-cases/gym/CreateGymUseCase';
import { UpdateGymUseCase } from '../../../application/use-cases/gym/UpdateGymUseCase';
import { DeleteGymUseCase } from '../../../application/use-cases/gym/DeleteGymUseCase';
import { ListGymsUseCase } from '../../../application/use-cases/gym/ListGymsUseCase';
import { UpdateAfipConfigUseCase } from '../../../application/use-cases/gym/UpdateAfipConfigUseCase';
import { UpdateAiConfigUseCase } from '../../../application/use-cases/gym/UpdateAiConfigUseCase';
import { UpdateWhatsappConfigUseCase } from '../../../application/use-cases/gym/UpdateWhatsappConfigUseCase';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoUserRepository } from '../../../infrastructure/database/mongoose/repositories/MongoUserRepository';
import { EncryptionService } from '../../../infrastructure/encryption/EncryptionService';
import { Gym } from '../../../domain/entities/Gym';
import { resolverPromptTemplate } from '../../../domain/prompt/promptStandard';
import { createGymSchema, updateGymSchema, updateAfipConfigSchema, updateAiConfigSchema, updateWhatsappConfigSchema } from '../validators/gym.validator';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';
import { NotFoundError } from '../../../shared/errors/AppError';

const createAdminGymRouter = () => {
  const router = Router();

  const gymRepository = new MongoGymRepository();
  const userRepository = new MongoUserRepository();

  const encryptionService = new EncryptionService();

  const createGymUseCase = new CreateGymUseCase(
    gymRepository,
    userRepository,
    encryptionService
  );
  const updateGymUseCase = new UpdateGymUseCase(gymRepository);
  const deleteGymUseCase = new DeleteGymUseCase(gymRepository);
  const listGymsUseCase = new ListGymsUseCase(gymRepository);
  const updateWhatsappConfigUseCase = new UpdateWhatsappConfigUseCase(
    gymRepository,
    encryptionService
  );

  const gymController = new GymController(
    createGymUseCase,
    updateGymUseCase,
    deleteGymUseCase,
    listGymsUseCase,
    updateWhatsappConfigUseCase,
    gymRepository
  );

  router.get('/', (_req, res, next) =>
    gymController.list(_req, res, next)
  );

  router.post('/', validateBody(createGymSchema), (req, res, next) =>
    gymController.create(req, res, next)
  );

  router.get('/:id', (req, res, next) =>
    gymController.get(req, res, next)
  );

  router.put('/:id', validateBody(updateGymSchema), (req, res, next) =>
    gymController.update(req, res, next)
  );

  router.delete('/:id', (req, res, next) =>
    gymController.delete(req, res, next)
  );

  return router;
};

/**
 * Proyecciones seguras de la config del gym.
 *
 * Las credenciales BYOK viven cifradas dentro de `aiConfig`/`whatsappConfig`, así que
 * devolver esos objetos enteros filtraría el ciphertext. Se exponen solo los campos
 * editables más un booleano que le dice al front si la credencial ya está cargada.
 */
const toSafeAiConfig = (gym: Gym) => {
  // Se devuelve el prompt EFECTIVO, no el campo crudo: si el gym nunca escribió el
  // suyo, el front recibe el standard ya cargado para editar en vez de un textarea
  // vacío, y `usaPromptStandard` le permite avisar que todavía no lo personalizó.
  const prompt = resolverPromptTemplate(gym.aiConfig?.promptTemplate);

  return {
    provider: gym.aiConfig?.provider,
    promptTemplate: prompt.template,
    usaPromptStandard: prompt.fuente === 'standard',
    model: gym.aiConfig?.model,
    hasApiKey: Boolean(gym.aiConfig?.encryptedApiKey),
  };
};

const toSafeWhatsappConfig = (gym: Gym) => ({
  phoneNumberId: gym.whatsappConfig?.phoneNumberId ?? null,
  hasAccessToken: Boolean(gym.whatsappConfig?.encryptedAccessToken),
});

const createUserGymRouter = () => {
  const router = Router();

  const gymRepository = new MongoGymRepository();
  const encryptionService = new EncryptionService();

  const updateAfipConfigUseCase = new UpdateAfipConfigUseCase(gymRepository, encryptionService);
  const updateAiConfigUseCase = new UpdateAiConfigUseCase(gymRepository, encryptionService);
  const updateWhatsappConfigUseCase = new UpdateWhatsappConfigUseCase(
    gymRepository,
    encryptionService
  );

  router.get('/settings', async (req: AuthenticatedRequest, res, next) => {
    try {
      const gymId = getTenantId(req);

      const gym = await gymRepository.findById(gymId);
      if (!gym) {
        throw new NotFoundError('Gym');
      }

      // Allowlist explícito: solo campos no sensibles. Nunca exponer secretos
      // (whatsappConfig.tokenSecretRef/encryptedAccessToken, aiConfig.encryptedApiKey,
      // afipConfig.encryptedApiKey/apiKeySecretRef, googleFormConfig.webhookSecret).
      const safeGym = {
        id: gym.id,
        name: gym.name,
        businessName: gym.businessName,
        cuit: gym.cuit,
        contactEmail: gym.contactEmail,
        contactPhone: gym.contactPhone,
        isActive: gym.isActive,
        aiConfig: toSafeAiConfig(gym),
        pdfTemplate: gym.pdfTemplate,
        whatsappConfig: toSafeWhatsappConfig(gym),
        // Se mantiene el campo plano por compatibilidad con el front actual
        whatsappPhoneNumberId: gym.whatsappConfig?.phoneNumberId ?? null,
        googleFormConfig: { formId: gym.googleFormConfig?.formId },
        afipConfig: gym.afipConfig
          ? {
              puntoVenta: gym.afipConfig.puntoVenta,
              taxCondition: gym.afipConfig.taxCondition,
              isActive: gym.afipConfig.isActive,
            }
          : undefined,
        createdAt: gym.createdAt,
        updatedAt: gym.updatedAt,
      };
      res.json({ status: 'success', data: safeGym });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/settings/ai-prompt',
    validateBody(updateAiConfigSchema),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const updatedGym = await updateAiConfigUseCase.execute({
          gymId: getTenantId(req),
          ...req.body,
        });

        res.json({ status: 'success', data: { aiConfig: toSafeAiConfig(updatedGym) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    '/settings/whatsapp',
    validateBody(updateWhatsappConfigSchema),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const updatedGym = await updateWhatsappConfigUseCase.execute({
          gymId: getTenantId(req),
          ...req.body,
        });

        res.json({
          status: 'success',
          data: { whatsappConfig: toSafeWhatsappConfig(updatedGym) },
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    '/settings/afip',
    validateBody(updateAfipConfigSchema),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const updatedGym = await updateAfipConfigUseCase.execute({
          gymId: getTenantId(req),
          ...req.body,
        });

        // No exponer el secreto: solo los campos AFIP no sensibles
        const afip = updatedGym.afipConfig;
        res.json({
          status: 'success',
          data: {
            afipConfig: afip
              ? {
                  puntoVenta: afip.puntoVenta,
                  taxCondition: afip.taxCondition,
                  isActive: afip.isActive,
                }
              : undefined,
          },
        });
      } catch (error) {
        next(error);
      }
    }
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

export const adminGymRoutes = createAdminGymRouter();
export const gymRoutes = createUserGymRouter();
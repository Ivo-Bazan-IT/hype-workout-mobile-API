import { Router } from 'express';
import { GymController } from '../controllers/GymController';
import { CreateGymUseCase } from '../../../application/use-cases/gym/CreateGymUseCase';
import { UpdateGymUseCase } from '../../../application/use-cases/gym/UpdateGymUseCase';
import { DeleteGymUseCase } from '../../../application/use-cases/gym/DeleteGymUseCase';
import { ListGymsUseCase } from '../../../application/use-cases/gym/ListGymsUseCase';
import { UpdateAfipConfigUseCase } from '../../../application/use-cases/gym/UpdateAfipConfigUseCase';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoUserRepository } from '../../../infrastructure/database/mongoose/repositories/MongoUserRepository';
import { EncryptionService } from '../../../infrastructure/encryption/EncryptionService';
import { createGymSchema, updateGymSchema, updateAfipConfigSchema } from '../validators/gym.validator';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

const createAdminGymRouter = () => {
  const router = Router();

  const gymRepository = new MongoGymRepository();
  const userRepository = new MongoUserRepository();

  const createGymUseCase = new CreateGymUseCase(gymRepository, userRepository);
  const updateGymUseCase = new UpdateGymUseCase(gymRepository);
  const deleteGymUseCase = new DeleteGymUseCase(gymRepository);
  const listGymsUseCase = new ListGymsUseCase(gymRepository);

  const gymController = new GymController(
    createGymUseCase,
    updateGymUseCase,
    deleteGymUseCase,
    listGymsUseCase
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

const createUserGymRouter = () => {
  const router = Router();

  const gymRepository = new MongoGymRepository();
  const updateAfipConfigUseCase = new UpdateAfipConfigUseCase(
    gymRepository,
    new EncryptionService()
  );

  router.get('/settings', async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user;
      if (!user?.gymId) {
        res.status(403).json({ status: 'error', message: 'Gym access required' });
        return;
      }

      const gym = await gymRepository.findById(user.gymId);
      if (!gym) {
        res.status(404).json({ status: 'error', message: 'Gym not found' });
        return;
      }

      // Allowlist explícito: solo campos no sensibles. Nunca exponer secretos
      // (whatsappConfig.tokenSecretRef, afipConfig.encryptedApiKey/apiKeySecretRef,
      // googleFormConfig.webhookSecret).
      const safeGym = {
        id: gym.id,
        name: gym.name,
        businessName: gym.businessName,
        cuit: gym.cuit,
        contactEmail: gym.contactEmail,
        contactPhone: gym.contactPhone,
        isActive: gym.isActive,
        aiConfig: gym.aiConfig,
        pdfTemplate: gym.pdfTemplate,
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

  router.put('/settings/ai-prompt', async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user;
      if (!user?.gymId) {
        res.status(403).json({ status: 'error', message: 'Gym access required' });
        return;
      }

      const { promptTemplate } = req.body;
      const gym = await gymRepository.update(user.gymId, {
        aiConfig: { promptTemplate } as any
      });

      res.json({ status: 'success', data: { aiConfig: gym?.aiConfig } });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/settings/afip',
    validateBody(updateAfipConfigSchema),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const user = req.user;
        if (!user?.gymId) {
          res.status(403).json({ status: 'error', message: 'Gym access required' });
          return;
        }

        const updatedGym = await updateAfipConfigUseCase.execute({
          gymId: user.gymId,
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
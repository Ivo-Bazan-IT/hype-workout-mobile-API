import { Router } from 'express';
import multer from 'multer';
import { GymController } from '../controllers/GymController';
import { CreateGymUseCase } from '../../../application/use-cases/gym/CreateGymUseCase';
import { UpdateGymUseCase } from '../../../application/use-cases/gym/UpdateGymUseCase';
import { DeleteGymUseCase } from '../../../application/use-cases/gym/DeleteGymUseCase';
import { ListGymsUseCase } from '../../../application/use-cases/gym/ListGymsUseCase';
import { UpdateAfipConfigUseCase } from '../../../application/use-cases/gym/UpdateAfipConfigUseCase';
import { UpdateAfipCredentialsUseCase } from '../../../application/use-cases/gym/UpdateAfipCredentialsUseCase';
import { UpdateMercadoPagoCredentialsUseCase } from '../../../application/use-cases/gym/UpdateMercadoPagoCredentialsUseCase';
import { UpdateAiConfigUseCase } from '../../../application/use-cases/gym/UpdateAiConfigUseCase';
import { UpdateWhatsappConfigUseCase } from '../../../application/use-cases/gym/UpdateWhatsappConfigUseCase';
import { UpdateGoogleFormConfigUseCase } from '../../../application/use-cases/gym/UpdateGoogleFormConfigUseCase';
import { RotateGoogleFormSecretUseCase } from '../../../application/use-cases/gym/RotateGoogleFormSecretUseCase';
import { UpdateMembershipPlansUseCase } from '../../../application/use-cases/gym/UpdateMembershipPlansUseCase';
import { UpdateServiciosUseCase } from '../../../application/use-cases/client/UpdateServiciosUseCase';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoUserRepository } from '../../../infrastructure/database/mongoose/repositories/MongoUserRepository';
import { EncryptionService } from '../../../infrastructure/encryption/EncryptionService';
import { BcryptWebhookSecretService } from '../../../infrastructure/encryption/BcryptWebhookSecretService';
import { MercadoPagoAdapterFactory } from '../../../infrastructure/external/payments/MercadoPagoAdapterFactory';
import { Gym } from '../../../domain/entities/Gym';
import { resolverPromptTemplate } from '../../../domain/prompt/promptStandard';
import {
  createGymSchema,
  updateGymSchema,
  updateAfipConfigSchema,
  updateAfipCredentialsSchema,
  updateMercadoPagoCredentialsSchema,
  updateAiConfigSchema,
  updateWhatsappConfigSchema,
  updateGoogleFormConfigSchema,
  updateMembershipPlansSchema,
} from '../validators/gym.validator';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

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

// Igual criterio que aiConfig/whatsappConfig: nunca se devuelve el ciphertext, solo
// si cada credencial de la cuenta propia (modo `cuenta_propia`) ya está cargada. El
// CUIT no viaja acá: vive en la raíz del Gym, no dentro de `afipConfig`.
const toSafeAfipConfig = (gym: Gym) =>
  gym.afipConfig
    ? {
        puntoVenta: gym.afipConfig.puntoVenta,
        taxCondition: gym.afipConfig.taxCondition,
        isActive: gym.afipConfig.isActive,
        hasApiKey: Boolean(gym.afipConfig.encryptedApiKey),
        hasCert: Boolean(gym.afipConfig.encryptedCert),
        hasKey: Boolean(gym.afipConfig.encryptedKey),
        credencialesActualizadasEn: gym.afipConfig.credencialesActualizadasEn ?? null,
      }
    : undefined;

// El hash del secreto tampoco se expone: al front le alcanza con saber si ya hay uno
// y de cuándo es, para poder ofrecer la rotación.
const toSafeGoogleFormConfig = (gym: Gym) => ({
  formId: gym.googleFormConfig?.formId ?? null,
  // El front los necesita para armar el link que se le manda al socio, y no son
  // secretos: el formulario es público por definición.
  formUrl: gym.googleFormConfig?.formUrl ?? null,
  documentoEntryId: gym.googleFormConfig?.documentoEntryId ?? null,
  hasWebhookSecret: Boolean(gym.googleFormConfig?.webhookSecretHash),
  webhookSecretUpdatedAt: gym.googleFormConfig?.webhookSecretUpdatedAt ?? null,
  // No es sensible y el front lo necesita para mostrar qué preguntas están fijadas
  // y cuáles se siguen resolviendo por heurística.
  fieldMapping: gym.googleFormConfig?.fieldMapping ?? {},
});

// Igual criterio que `toSafeAfipConfig`: nunca se devuelve el token ni el
// secreto del webhook, solo si cada uno ya está cargado y desde cuándo.
const toSafeMercadoPagoConfig = (gym: Gym) => ({
  conectado: Boolean(gym.mercadoPagoConfig?.mpUserId),
  hasAccessToken: Boolean(gym.mercadoPagoConfig?.encryptedAccessToken),
  hasWebhookSecret: Boolean(gym.mercadoPagoConfig?.encryptedWebhookSecret),
  credencialesActualizadasEn: gym.mercadoPagoConfig?.credencialesActualizadasEn ?? null,
});

const createUserGymRouter = () => {
  const router = Router();

  const gymRepository = new MongoGymRepository();
  const encryptionService = new EncryptionService();

  const paymentProviderFactory = new MercadoPagoAdapterFactory();

  const updateAfipConfigUseCase = new UpdateAfipConfigUseCase(gymRepository);
  const updateAfipCredentialsUseCase = new UpdateAfipCredentialsUseCase(gymRepository, encryptionService);
  const updateMercadoPagoCredentialsUseCase = new UpdateMercadoPagoCredentialsUseCase(
    gymRepository,
    paymentProviderFactory,
    encryptionService
  );
  const updateAiConfigUseCase = new UpdateAiConfigUseCase(gymRepository, encryptionService);
  const updateWhatsappConfigUseCase = new UpdateWhatsappConfigUseCase(
    gymRepository,
    encryptionService
  );
  const updateGoogleFormConfigUseCase = new UpdateGoogleFormConfigUseCase(gymRepository);
  const rotateGoogleFormSecretUseCase = new RotateGoogleFormSecretUseCase(
    gymRepository,
    new BcryptWebhookSecretService()
  );
  const updateMembershipPlansUseCase = new UpdateMembershipPlansUseCase(gymRepository);

  router.get('/settings', async (req: AuthenticatedRequest, res, next) => {
    try {
      const gymId = getTenantId(req);

      const gym = await gymRepository.findById(gymId);
      if (!gym) {
        throw new NotFoundError('Gym');
      }

      // Allowlist explícito: solo campos no sensibles. Nunca exponer secretos
      // (whatsappConfig.tokenSecretRef/encryptedAccessToken, aiConfig.encryptedApiKey,
      // googleFormConfig.webhookSecretHash). `afipConfig` ya no guarda secretos.
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
        googleFormConfig: toSafeGoogleFormConfig(gym),
        afipConfig: toSafeAfipConfig(gym),
        mercadoPagoConfig: toSafeMercadoPagoConfig(gym),
        // No es sensible: es el catálogo de precios que arma el propio dueño.
        membershipPlans: gym.membershipPlans,
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
    '/settings/google-form',
    validateBody(updateGoogleFormConfigSchema),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const updatedGym = await updateGoogleFormConfigUseCase.execute({
          gymId: getTenantId(req),
          ...req.body,
        });

        res.json({
          status: 'success',
          data: { googleFormConfig: toSafeGoogleFormConfig(updatedGym) },
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * Genera un secreto nuevo para el webhook del Form e invalida el anterior.
   *
   * Es la ÚNICA respuesta del sistema que incluye el secreto en claro: se guarda
   * hasheado, así que si el gym no lo copia acá, no lo recupera más y tiene que
   * volver a rotar. Va por POST y no por PUT porque no es idempotente.
   */
  router.post(
    '/settings/google-form/rotate-secret',
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const { gym, secret } = await rotateGoogleFormSecretUseCase.execute({
          gymId: getTenantId(req),
        });

        res.json({
          status: 'success',
          data: {
            secret,
            webhookSecretUpdatedAt: gym.googleFormConfig?.webhookSecretUpdatedAt ?? null,
            message: 'Guardá este secreto ahora: no se puede volver a consultar.',
          },
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

        res.json({
          status: 'success',
          data: {
            // El CUIT viaja al lado de la config aunque viva en la raíz del gym: es
            // parte de lo que se edita en esta pantalla, y el front necesita poder
            // releerlo después de guardarlo.
            cuit: updatedGym.cuit,
            afipConfig: toSafeAfipConfig(updatedGym),
          },
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * Carga o rota la credencial de la cuenta PROPIA de AFIP SDK del gym: access
   * token (texto) + certificado + clave privada (archivos). Multipart porque
   * `.crt`/`.key` son archivos, no un campo de un JSON.
   *
   * Memoria y no disco: son archivos PEM de pocos KB, y así no queda un archivo
   * en claro tirado en el filesystem del server ni un paso extra de limpieza.
   * `fileSize` acota el abuso — un .crt/.key real nunca se acerca a ese tamaño.
   */
  const afipCredentialsUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 64 * 1024 },
  });

  router.put(
    '/settings/afip/credenciales',
    afipCredentialsUpload.fields([
      { name: 'cert', maxCount: 1 },
      { name: 'key', maxCount: 1 },
    ]),
    validateBody(updateAfipCredentialsSchema),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
        const cert = files.cert?.[0];
        const key = files.key?.[0];

        if (req.body.apiKey === undefined && !cert && !key) {
          throw new ValidationError('Hay que enviar al menos una credencial (apiKey, cert o key)');
        }

        const updatedGym = await updateAfipCredentialsUseCase.execute({
          gymId: getTenantId(req),
          apiKey: req.body.apiKey,
          cert: cert?.buffer.toString('utf8'),
          key: key?.buffer.toString('utf8'),
        });

        res.json({ status: 'success', data: { afipConfig: toSafeAfipConfig(updatedGym) } });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * Carga o rota la credencial PROPIA de Mercado Pago del gym: access token de
   * producción + secreto de webhook de SU integración. JSON normal (a
   * diferencia de AFIP, acá no hay archivos) — mismo criterio "al menos una,
   * mergea sobre lo existente" que `PUT /settings/afip/credenciales`.
   *
   * Sin OAuth desde el 22/08/2026: no hay app de plataforma que aprobar ni
   * popup de login. El `mpUserId` no lo tipea el dueño — lo resuelve el caso de
   * uso llamando a `GET /users/me` con el token que mandó, lo que de paso
   * valida que el token sirve antes de guardarlo.
   */
  router.put(
    '/settings/mercadopago/credenciales',
    validateBody(updateMercadoPagoCredentialsSchema),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const updatedGym = await updateMercadoPagoCredentialsUseCase.execute({
          gymId: getTenantId(req),
          ...req.body,
        });

        res.json({ status: 'success', data: { mercadoPagoConfig: toSafeMercadoPagoConfig(updatedGym) } });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * Desconecta la cuenta de Mercado Pago del gym. Se limpia con un objeto vacío
   * y no con `undefined`: el repositorio solo pisa `mercadoPagoConfig` cuando el
   * campo viene definido en el `data` (mismo allowlist que el resto de `update`),
   * así que un `undefined` explícito no haría nada.
   */
  router.delete('/settings/mercadopago', async (req: AuthenticatedRequest, res, next) => {
    try {
      const gymId = getTenantId(req);
      await gymRepository.update(gymId, { mercadoPagoConfig: {} });

      res.json({ status: 'success', message: 'Cuenta de Mercado Pago desconectada.' });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/settings/servicios',
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const updateServiciosUseCase = new UpdateServiciosUseCase(gymRepository);
        const updatedGym = await updateServiciosUseCase.execute({
          gymId: getTenantId(req),
          servicios: req.body.servicios ?? [],
        });
        res.json({ status: 'success', data: { servicios: (updatedGym as any).servicios } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    '/settings/membership-plans',
    validateBody(updateMembershipPlansSchema),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const updatedGym = await updateMembershipPlansUseCase.execute({
          gymId: getTenantId(req),
          planes: req.body.planes,
        });

        res.json({ status: 'success', data: { membershipPlans: updatedGym.membershipPlans } });
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
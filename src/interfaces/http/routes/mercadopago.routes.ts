import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoGymSecretsRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymSecretsRepository';
import { MongoRenewalRequestRepository } from '../../../infrastructure/database/mongoose/repositories/MongoRenewalRequestRepository';
import { MongoInvoiceRepository } from '../../../infrastructure/database/mongoose/repositories/MongoInvoiceRepository';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { MongoMembershipEventRepository } from '../../../infrastructure/database/mongoose/repositories/MongoMembershipEventRepository';
import { EncryptionService } from '../../../infrastructure/encryption/EncryptionService';
import { MercadoPagoOAuthAdapter } from '../../../infrastructure/external/payments/MercadoPagoOAuthAdapter';
import { MercadoPagoAdapterFactory } from '../../../infrastructure/external/payments/MercadoPagoAdapterFactory';
import { verificarFirmaMercadoPago } from '../../../infrastructure/external/payments/mercadoPagoSignature';
import { HandleMercadoPagoCallbackUseCase } from '../../../application/use-cases/payments/HandleMercadoPagoCallbackUseCase';
import { ResolverMercadoPagoAccessTokenUseCase } from '../../../application/use-cases/payments/ResolverMercadoPagoAccessTokenUseCase';
import { ProcessMercadoPagoWebhookUseCase } from '../../../application/use-cases/payments/ProcessMercadoPagoWebhookUseCase';
import { AplicarRenovacionUseCase } from '../../../application/use-cases/client/AplicarRenovacionUseCase';
import { mercadoPagoCallbackSchema } from '../validators/gym.validator';
import { env } from '../../../config/env';
import { ValidationError } from '../../../shared/errors/AppError';

/**
 * Las dos superficies PÚBLICAS de Mercado Pago — ninguna lleva JWT, porque del
 * otro lado no hay un usuario logueado: es el navegador volviendo de
 * mercadopago.com (`/callback`) o el propio Mercado Pago avisando un pago
 * (`/webhook`). El resto de la integración (conectar, desconectar, catálogo de
 * planes, pedir un link) vive detrás de `authMiddleware` en `gym.routes.ts` /
 * `client.routes.ts`, como corresponde a algo que dispara un operador logueado.
 *
 * Montado en `routes/index.ts` ANTES del `authMiddleware` global, mismo lugar
 * que `/onboarding` y `/internal`.
 */

const construirMercadoPagoOAuthAdapter = (): MercadoPagoOAuthAdapter => {
  if (!env.MERCADOPAGO_CLIENT_ID || !env.MERCADOPAGO_CLIENT_SECRET || !env.MERCADOPAGO_REDIRECT_URI) {
    throw new ValidationError(
      'Mercado Pago no está configurado en la plataforma (faltan MERCADOPAGO_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI).'
    );
  }
  return new MercadoPagoOAuthAdapter(
    env.MERCADOPAGO_CLIENT_ID,
    env.MERCADOPAGO_CLIENT_SECRET,
    env.MERCADOPAGO_REDIRECT_URI
  );
};

function validateQuery(schema: z.ZodSchema<any>) {
  return (req: any, _res: any, next: any) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const createMercadoPagoPublicRouter = (): Router => {
  const router = Router();

  const gymRepository = new MongoGymRepository();
  const encryptionService = new EncryptionService();
  const gymSecretsRepo = new MongoGymSecretsRepository(encryptionService);
  const renewalRequestRepository = new MongoRenewalRequestRepository();
  const invoiceRepository = new MongoInvoiceRepository();
  const clientRepository = new MongoClientRepository();
  const membershipEventRepository = new MongoMembershipEventRepository();
  const paymentProviderFactory = new MercadoPagoAdapterFactory();

  /**
   * `GET /api/mercadopago/callback` — vuelta del navegador desde mercadopago.com
   * tras autorizar la conexión. El `state` (armado en
   * `GET /gyms/settings/mercadopago/connect`) es un payload cifrado con
   * `EncryptionService`: probar que se descifra ya prueba que no fue adulterado
   * (AES-256-GCM autentica), y el `exp` adentro corta un `state` viejo reusado.
   */
  router.get('/callback', validateQuery(mercadoPagoCallbackSchema), async (req, res, next) => {
    try {
      const { code, state } = req.query as unknown as { code: string; state: string };

      let payload: { gymId: string; exp: number };
      try {
        payload = JSON.parse(encryptionService.decrypt(state));
      } catch {
        throw new ValidationError(
          'El link de conexión no es válido. Volvé a intentarlo desde Configuración > Mercado Pago.'
        );
      }

      if (!payload.gymId || payload.exp < Date.now()) {
        throw new ValidationError(
          'El link de conexión venció. Volvé a intentarlo desde Configuración > Mercado Pago.'
        );
      }

      const oauthService = construirMercadoPagoOAuthAdapter();
      const useCase = new HandleMercadoPagoCallbackUseCase(gymRepository, oauthService, encryptionService);
      await useCase.execute({ gymId: payload.gymId, code });

      // Sin redirect a una URL de front fija a propósito: acoplaría este
      // endpoint público a un dominio de front que puede cambiar, y hoy no hay
      // ningún dominio propio todavía (ver D1 en BACKEND-requerimientos-dashboard.md).
      res.json({
        status: 'success',
        data: { message: 'Cuenta de Mercado Pago conectada correctamente. Ya podés cerrar esta pestaña.' }
      });
    } catch (error) {
      next(error);
    }
  });

  const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: 'Too many requests',
  });

  /**
   * `POST /api/payments/mercadopago/webhook` — lo llama Mercado Pago, nunca el
   * front. Contrato del body verificado contra la documentación pública de
   * Mercado Pago: `{ type: "payment", data: { id }, user_id }`.
   */
  router.post('/webhook', webhookLimiter, async (req, res, next) => {
    try {
      const type = req.body?.type as string | undefined;
      const dataId = req.body?.data?.id as string | number | undefined;
      const userId = req.body?.user_id;

      if (!type || dataId === undefined || userId === undefined) {
        // No hay nada que reintentar con un payload que no calza: se responde
        // 200 igual y se deja registrado para poder mirarlo después.
        console.warn('⚠️  Webhook de Mercado Pago con forma inesperada:', req.body);
        res.json({ status: 'success', data: { procesado: false, motivo: 'Payload inesperado' } });
        return;
      }

      // Sin secreto no se degrada a "abierto": se cierra, mismo criterio que
      // `internalAuthMiddleware`. Un webhook sin verificar podría hacer que
      // cualquiera dispare renovaciones gratis con un `externalReference` adivinado.
      if (!env.MERCADOPAGO_WEBHOOK_SECRET) {
        res.status(503).json({ status: 'error', message: 'Mercado Pago webhook is not configured' });
        return;
      }

      const xSignature = req.header('x-signature');
      const xRequestId = req.header('x-request-id');

      if (
        !xSignature ||
        !xRequestId ||
        !verificarFirmaMercadoPago({
          xSignature,
          xRequestId,
          dataId: String(dataId),
          secret: env.MERCADOPAGO_WEBHOOK_SECRET
        })
      ) {
        res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
        return;
      }

      const oauthService = construirMercadoPagoOAuthAdapter();
      const resolverAccessToken = new ResolverMercadoPagoAccessTokenUseCase(
        gymRepository,
        gymSecretsRepo,
        oauthService,
        encryptionService
      );
      const aplicarRenovacion = new AplicarRenovacionUseCase(
        clientRepository,
        gymRepository,
        invoiceRepository,
        membershipEventRepository
      );
      const useCase = new ProcessMercadoPagoWebhookUseCase(
        gymRepository,
        renewalRequestRepository,
        paymentProviderFactory,
        resolverAccessToken,
        aplicarRenovacion
      );

      const resultado = await useCase.execute({ type, dataId: String(dataId), userId: String(userId) });

      res.json({ status: 'success', data: resultado });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

export const mercadoPagoPublicRoutes = createMercadoPagoPublicRouter();

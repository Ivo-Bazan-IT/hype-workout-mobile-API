import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoRenewalRequestRepository } from '../../../infrastructure/database/mongoose/repositories/MongoRenewalRequestRepository';
import { MongoInvoiceRepository } from '../../../infrastructure/database/mongoose/repositories/MongoInvoiceRepository';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { MongoMembershipEventRepository } from '../../../infrastructure/database/mongoose/repositories/MongoMembershipEventRepository';
import { EncryptionService } from '../../../infrastructure/encryption/EncryptionService';
import { MercadoPagoAdapterFactory } from '../../../infrastructure/external/payments/MercadoPagoAdapterFactory';
import { verificarFirmaMercadoPago } from '../../../infrastructure/external/payments/mercadoPagoSignature';
import { ProcessMercadoPagoWebhookUseCase } from '../../../application/use-cases/payments/ProcessMercadoPagoWebhookUseCase';
import { AplicarRenovacionUseCase } from '../../../application/use-cases/client/AplicarRenovacionUseCase';

/**
 * La única superficie PÚBLICA de Mercado Pago — sin JWT, porque del otro lado
 * no hay un usuario logueado: es el propio Mercado Pago avisando un pago. El
 * resto de la integración (cargar credencial, desconectar, catálogo de
 * planes, pedir un link) vive detrás de `authMiddleware` en `gym.routes.ts` /
 * `client.routes.ts`, como corresponde a algo que dispara un operador logueado.
 *
 * Montado en `routes/index.ts` ANTES del `authMiddleware` global, mismo lugar
 * que `/onboarding` y `/internal`.
 *
 * Desde el 22/08/2026 no hay callback OAuth acá: cada gym carga su propia
 * credencial a mano por `PUT /gyms/settings/mercadopago/credenciales`, sin
 * popup ni app de plataforma.
 */

export const createMercadoPagoPublicRouter = (): Router => {
  const router = Router();

  const gymRepository = new MongoGymRepository();
  const encryptionService = new EncryptionService();
  const renewalRequestRepository = new MongoRenewalRequestRepository();
  const invoiceRepository = new MongoInvoiceRepository();
  const clientRepository = new MongoClientRepository();
  const membershipEventRepository = new MongoMembershipEventRepository();
  const paymentProviderFactory = new MercadoPagoAdapterFactory();

  const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: 'Too many requests',
  });

  /**
   * `POST /api/mercadopago/webhook` — lo llama Mercado Pago, nunca el front.
   * Contrato del body verificado contra la documentación pública de Mercado
   * Pago: `{ type: "payment", data: { id }, user_id }`.
   *
   * A diferencia de antes del 22/08/2026, el secreto para verificar la firma
   * NO es único de plataforma: cada gym tiene el suyo (cargado junto con su
   * access token), así que hay que encontrar primero A QUÉ GYM pertenece la
   * notificación —por su `user_id`, lo único confiable que trae el body— y
   * recién ahí verificar con el secreto de ESE gym. Es seguro aunque el
   * `user_id` todavía no esté verificado: un atacante que lo adivine igual
   * necesita producir un HMAC válido con un secreto que no tiene.
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

      const gym = await gymRepository.findByMercadoPagoUserId(String(userId));
      if (!gym) {
        // Ni siquiera hay con qué verificar la firma: no hay gym conectado con
        // ese user_id. Mismo criterio que un pedido de renovación que no
        // matchea — no es un error del webhook, es ruido que se ignora.
        res.json({
          status: 'success',
          data: { procesado: false, motivo: `Ningún gym conectado con el user_id ${userId}.` }
        });
        return;
      }

      // Sin secreto propio no se degrada a "abierto": se cierra, mismo criterio
      // que `internalAuthMiddleware`. Un webhook sin verificar podría hacer que
      // cualquiera dispare renovaciones gratis con un `externalReference` adivinado.
      if (!gym.mercadoPagoConfig?.encryptedWebhookSecret) {
        res.status(503).json({
          status: 'error',
          message: 'Este gimnasio todavía no cargó el secreto de webhook de Mercado Pago'
        });
        return;
      }

      const xSignature = req.header('x-signature');
      const xRequestId = req.header('x-request-id');
      const webhookSecret = encryptionService.decrypt(gym.mercadoPagoConfig.encryptedWebhookSecret);

      if (
        !xSignature ||
        !xRequestId ||
        !verificarFirmaMercadoPago({
          xSignature,
          xRequestId,
          dataId: String(dataId),
          secret: webhookSecret
        })
      ) {
        res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
        return;
      }

      if (!gym.mercadoPagoConfig?.encryptedAccessToken) {
        res.status(503).json({
          status: 'error',
          message: 'Este gimnasio todavía no cargó su access token de Mercado Pago'
        });
        return;
      }

      const accessToken = encryptionService.decrypt(gym.mercadoPagoConfig.encryptedAccessToken);

      const aplicarRenovacion = new AplicarRenovacionUseCase(
        clientRepository,
        gymRepository,
        invoiceRepository,
        membershipEventRepository
      );
      const useCase = new ProcessMercadoPagoWebhookUseCase(
        renewalRequestRepository,
        paymentProviderFactory,
        aplicarRenovacion
      );

      const resultado = await useCase.execute({
        type,
        dataId: String(dataId),
        gymId: gym.id,
        accessToken
      });

      res.json({ status: 'success', data: resultado });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

export const mercadoPagoPublicRoutes = createMercadoPagoPublicRouter();

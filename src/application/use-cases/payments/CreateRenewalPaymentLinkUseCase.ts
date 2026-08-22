import { randomUUID } from 'crypto';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { IRenewalRequestRepository } from '../../../domain/repositories/IRenewalRequestRepository';
import { IPaymentProviderFactory } from '../../../domain/services/IPaymentProviderFactory';
import { IWhatsappProviderFactory } from '../../../domain/services/IWhatsappProviderFactory';
import { RenewalRequest } from '../../../domain/entities/RenewalRequest';
import { Client } from '../../../domain/entities/Client';
import { MembershipPlanType } from '../../../domain/entities/Gym';
import { calcularNuevoVencimiento } from '../../../domain/billing/planesMembresia';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface CreateRenewalPaymentLinkDTO {
  clientId: string;
  gymId: string;
  tipoPlan: MembershipPlanType;
}

/**
 * Paso 1 del cobro por Mercado Pago: el operador elige un plan, el CRM genera el
 * link con el monto de ese plan y se lo manda al socio por WhatsApp.
 *
 * A propósito, esto NO toca al `Client` todavía — ni su `estado` ni su
 * `fechaVencimiento`. La renovación real la aplica `ProcessMercadoPagoWebhookUseCase`
 * recién cuando Mercado Pago confirma el pago. El front deriva el badge de
 * "renovación pendiente" consultando el historial de pedidos, no un campo del
 * cliente.
 */
export class CreateRenewalPaymentLinkUseCase {
  constructor(
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository,
    private gymSecretsRepo: IGymSecretsRepository,
    private renewalRequestRepository: IRenewalRequestRepository,
    private paymentProviderFactory: IPaymentProviderFactory,
    private whatsappProviderFactory: IWhatsappProviderFactory
  ) {}

  async execute(dto: CreateRenewalPaymentLinkDTO): Promise<RenewalRequest> {
    const client = await this.clientRepository.findById(dto.clientId, dto.gymId);
    if (!client) {
      throw new NotFoundError('Client');
    }

    const gym = await this.gymRepository.findById(dto.gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }

    if (!gym.mercadoPagoConfig?.mpUserId) {
      throw new ValidationError('El gimnasio todavía no cargó su credencial de Mercado Pago.');
    }

    const plan = gym.membershipPlans.find((p) => p.tipo === dto.tipoPlan && p.activo);
    if (!plan) {
      throw new ValidationError(
        `El gimnasio no tiene configurado (o activo) el plan "${dto.tipoPlan}". Cargalo en Configuración > Planes.`
      );
    }

    // Un pedido nuevo reemplaza cualquier link todavía en el aire para este socio:
    // evita que dos links queden cobrables al mismo tiempo.
    const pendiente = await this.renewalRequestRepository.findPendienteByClientId(
      dto.clientId,
      dto.gymId
    );
    if (pendiente) {
      await this.renewalRequestRepository.update(pendiente.id, dto.gymId, {
        estado: 'cancelado',
        resueltoEn: new Date()
      });
    }

    const nuevaFechaVencimiento = calcularNuevoVencimiento(client.fechaVencimiento, plan.duracionDias);
    const externalReference = randomUUID();

    let renewalRequest = await this.renewalRequestRepository.create({
      gymId: dto.gymId,
      clientId: dto.clientId,
      plan: { tipo: plan.tipo, duracionDias: plan.duracionDias, monto: plan.monto },
      externalReference,
      fechaVencimientoAnterior: client.fechaVencimiento,
      fechaVencimientoNueva: nuevaFechaVencimiento
    });

    const credenciales = await this.gymSecretsRepo.getMercadoPagoCredentials(dto.gymId);
    if (!credenciales) {
      throw new ValidationError('El gimnasio todavía no cargó su credencial de Mercado Pago.');
    }
    const paymentProvider = this.paymentProviderFactory.create({ accessToken: credenciales.accessToken });

    const { paymentLinkId, initPoint } = await paymentProvider.crearLinkPago({
      externalReference,
      monto: plan.monto,
      descripcion: `Cuota ${plan.tipo} - ${client.nombre}`
    });

    renewalRequest = (await this.renewalRequestRepository.update(renewalRequest.id, dto.gymId, {
      mercadoPagoPaymentLinkId: paymentLinkId,
      initPoint
    }))!;

    await this.intentarEnvioWhatsapp(gym.id, client, initPoint);

    return renewalRequest;
  }

  /**
   * Best-effort, mismo criterio que el envío de rutinas por WhatsApp: para cuando
   * se llega acá el link YA es válido y está guardado. Que falte el teléfono del
   * socio o falle Meta no puede invalidar un link que ya se puede pagar.
   */
  private async intentarEnvioWhatsapp(gymId: string, client: Client, initPoint: string): Promise<void> {
    try {
      const gym = await this.gymRepository.findById(gymId);
      const accessToken = await this.gymSecretsRepo.getWhatsappAccessToken(gymId);
      const phoneNumberId = gym?.whatsappConfig?.phoneNumberId;

      if (!accessToken || !phoneNumberId || !client.telefono) {
        return;
      }

      const whatsappProvider = this.whatsappProviderFactory.create({ phoneNumberId, accessToken });
      await whatsappProvider.sendTextMessage({
        to: client.telefono,
        text: `Hola ${client.nombre}! Para renovar tu membresía, pagá acá: ${initPoint}`
      });
    } catch (error) {
      console.error(`❌ No se pudo enviar el link de pago por WhatsApp (gym ${gymId}):`, error);
    }
  }
}

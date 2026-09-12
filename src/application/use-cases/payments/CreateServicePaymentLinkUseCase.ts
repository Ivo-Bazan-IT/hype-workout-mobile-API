import { randomUUID } from 'crypto';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { IServicePaymentRequestRepository } from '../../../domain/repositories/IServicePaymentRequestRepository';
import { IPaymentProviderFactory } from '../../../domain/services/IPaymentProviderFactory';
import { IWhatsappProviderFactory } from '../../../domain/services/IWhatsappProviderFactory';
import { ServicePaymentRequest } from '../../../domain/entities/ServicePaymentRequest';
import { Client } from '../../../domain/entities/Client';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface CreateServicePaymentLinkDTO {
  servicioId: string;
  gymId: string;
  clientId: string;
}

export class CreateServicePaymentLinkUseCase {
  constructor(
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository,
    private gymSecretsRepo: IGymSecretsRepository,
    private servicePaymentRequestRepository: IServicePaymentRequestRepository,
    private paymentProviderFactory: IPaymentProviderFactory,
    private whatsappProviderFactory: IWhatsappProviderFactory
  ) {}

  async execute(dto: CreateServicePaymentLinkDTO): Promise<ServicePaymentRequest> {
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

    const servicio = gym.servicios?.find((s) => s.id === dto.servicioId && s.activo);
    if (!servicio) {
      throw new ValidationError(`Servicio no encontrado o inactivo.`);
    }

    const externalReference = randomUUID();

    const servicePaymentRequest = await this.servicePaymentRequestRepository.create({
      gymId: dto.gymId,
      clientId: dto.clientId,
      servicioId: dto.servicioId,
      tipo: 'servicio',
      referencia: { servicioId: servicio.id },
      monto: servicio.precio,
      estado: 'pendiente',
    });

    const credenciales = await this.gymSecretsRepo.getMercadoPagoCredentials(dto.gymId);
    if (!credenciales) {
      throw new ValidationError('El gimnasio todavía no cargó su credencial de Mercado Pago.');
    }
    const paymentProvider = this.paymentProviderFactory.create({ accessToken: credenciales.accessToken });

    const { paymentLinkId, initPoint } = await paymentProvider.crearLinkPago({
      externalReference,
      monto: servicio.precio,
      descripcion: `Servicio: ${servicio.nombre} - ${client.nombre}`
    });

    await this.servicePaymentRequestRepository.update(servicePaymentRequest.id, dto.gymId, {
      mercadoPagoPaymentLinkId: paymentLinkId,
      initPoint,
    });

    await this.intentarEnvioWhatsapp(gym.id, client, initPoint);

    return servicePaymentRequest;
  }

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
        text: `Hola ${client.nombre}! Para pagar tu servicio, usá este link: ${initPoint}`
      });
    } catch (error) {
      console.error(`❌ No se pudo enviar el link de servicio por WhatsApp (gym ${gymId}):`, error);
    }
  }
}

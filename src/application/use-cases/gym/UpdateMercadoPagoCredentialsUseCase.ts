import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IPaymentProviderFactory } from '../../../domain/services/IPaymentProviderFactory';
import { IEncryptionService } from '../../../domain/services/IEncryptionService';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface UpdateMercadoPagoCredentialsDTO {
  gymId: string;
  /** Access token de producción (Checkout Pro) de la cuenta propia del gym. */
  accessToken?: string;
  /** Secreto de la integración del gym (Tus integraciones > Webhooks). */
  webhookSecret?: string;
}

/**
 * Carga o rota la credencial PROPIA de Mercado Pago del gym: access token +
 * secreto de webhook, mismo patrón que `UpdateAfipCredentialsUseCase` — sin
 * OAuth, sin popup, sin app de plataforma. Reemplazó al flujo OAuth el
 * 22/08/2026: como todavía nadie había conectado una cuenta real, no hubo
 * migración de datos.
 *
 * MERGE sobre lo existente, así que se puede rotar una sola de las dos
 * credenciales sin tener que resubir la otra.
 */
export class UpdateMercadoPagoCredentialsUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private paymentProviderFactory: IPaymentProviderFactory,
    private encryptionService: IEncryptionService
  ) {}

  async execute(dto: UpdateMercadoPagoCredentialsDTO): Promise<Gym> {
    if (dto.accessToken === undefined && dto.webhookSecret === undefined) {
      throw new ValidationError('Hay que enviar al menos una credencial (accessToken o webhookSecret)');
    }

    const gym = await this.gymRepository.findById(dto.gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }

    let mpUserId = gym.mercadoPagoConfig?.mpUserId;

    if (dto.accessToken !== undefined) {
      // No se confía en que lo que pegó el dueño sea válido ni en que sea SU
      // cuenta: se le pregunta a Mercado Pago de verdad. Si el token no sirve,
      // esto lanza y no se guarda nada — mejor que descubrirlo recién al
      // intentar cobrar el primer link.
      const provider = this.paymentProviderFactory.create({ accessToken: dto.accessToken });
      const cuenta = await provider.obtenerCuenta();
      mpUserId = cuenta.userId;
    }

    const updated = await this.gymRepository.update(dto.gymId, {
      mercadoPagoConfig: {
        ...gym.mercadoPagoConfig,
        ...(dto.accessToken !== undefined && {
          encryptedAccessToken: this.encryptionService.encrypt(dto.accessToken)
        }),
        ...(dto.webhookSecret !== undefined && {
          encryptedWebhookSecret: this.encryptionService.encrypt(dto.webhookSecret)
        }),
        mpUserId,
        credencialesActualizadasEn: new Date()
      }
    });

    return updated!;
  }
}

import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IRenewalRequestRepository } from '../../../domain/repositories/IRenewalRequestRepository';
import { IPaymentProviderFactory } from '../../../domain/services/IPaymentProviderFactory';
import { AplicarRenovacionUseCase } from '../client/AplicarRenovacionUseCase';
import { ResolverMercadoPagoAccessTokenUseCase } from './ResolverMercadoPagoAccessTokenUseCase';

interface ProcessWebhookDTO {
  type: string;
  dataId: string;
  /** `user_id` del vendedor conectado, tal como viaja en el body del webhook. */
  userId: string;
}

interface ResultadoWebhook {
  procesado: boolean;
  motivo?: string;
}

/**
 * Paso 2/3 del cobro por Mercado Pago: confirma un pago y, si está aprobado,
 * aplica la renovación real a través de `AplicarRenovacionUseCase` — el mismo
 * camino que usa la renovación manual en efectivo.
 *
 * Nunca lanza por un pago que no corresponde procesar (ruido, duplicado, estado
 * no definitivo): esos casos devuelven `procesado: false` con el motivo, y el
 * controller responde 200 igual — Mercado Pago reintenta un webhook que no
 * contesta 2xx, y un pago que ya se procesó no tiene por qué disparar un reintento.
 */
export class ProcessMercadoPagoWebhookUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private renewalRequestRepository: IRenewalRequestRepository,
    private paymentProviderFactory: IPaymentProviderFactory,
    private resolverAccessToken: ResolverMercadoPagoAccessTokenUseCase,
    private aplicarRenovacion: AplicarRenovacionUseCase
  ) {}

  async execute(dto: ProcessWebhookDTO): Promise<ResultadoWebhook> {
    if (dto.type !== 'payment') {
      return { procesado: false, motivo: `Notificación de tipo "${dto.type}", se ignora.` };
    }

    // El webhook no trae `gymId`: el `user_id` del vendedor conectado es el único
    // dato confiable para saber a qué tenant pertenece.
    const gym = await this.gymRepository.findByMercadoPagoUserId(dto.userId);
    if (!gym) {
      return { procesado: false, motivo: `Ningún gym conectado con el user_id ${dto.userId}.` };
    }

    const accessToken = await this.resolverAccessToken.execute(gym.id);
    const paymentProvider = this.paymentProviderFactory.create({ accessToken });

    // Nunca se confía en el body del webhook a secas: se vuelve a pedir el pago
    // real a la API de Mercado Pago con la cuenta de ESE gym.
    const pago = await paymentProvider.obtenerPago(dto.dataId);

    if (!pago.externalReference) {
      return { procesado: false, motivo: 'El pago no trae externalReference.' };
    }

    const renewalRequest = await this.renewalRequestRepository.findByExternalReference(
      pago.externalReference
    );
    if (!renewalRequest || renewalRequest.gymId !== gym.id) {
      return {
        procesado: false,
        motivo: `Ningún pedido de renovación para externalReference ${pago.externalReference}.`
      };
    }

    // Idempotencia: Mercado Pago reenvía notificaciones, y aplicar la renovación
    // dos veces le sumaría el doble de días de más al socio.
    if (renewalRequest.estado !== 'pendiente') {
      return { procesado: false, motivo: `El pedido ya estaba en estado "${renewalRequest.estado}".` };
    }

    if (pago.status === 'approved') {
      await this.aplicarRenovacion.execute({
        clientId: renewalRequest.clientId,
        gymId: renewalRequest.gymId,
        monto: renewalRequest.plan.monto,
        nuevaFechaVencimiento: renewalRequest.fechaVencimientoNueva,
        descripcion: `Cuota ${renewalRequest.plan.tipo} - Mercado Pago`
      });

      await this.renewalRequestRepository.update(renewalRequest.id, renewalRequest.gymId, {
        estado: 'aprobado',
        mercadoPagoPaymentId: pago.id,
        resueltoEn: new Date()
      });

      return { procesado: true };
    }

    if (pago.status === 'rejected' || pago.status === 'cancelled') {
      await this.renewalRequestRepository.update(renewalRequest.id, renewalRequest.gymId, {
        estado: 'rechazado',
        mercadoPagoPaymentId: pago.id,
        resueltoEn: new Date()
      });

      return { procesado: true };
    }

    // pending / in_process / etc: nada definitivo todavía, se espera el próximo webhook.
    return { procesado: false, motivo: `El pago está en estado "${pago.status}", todavía no es definitivo.` };
  }
}

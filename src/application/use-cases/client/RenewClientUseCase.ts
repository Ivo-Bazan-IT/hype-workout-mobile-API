import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IInvoiceRepository } from '../../../domain/repositories/IInvoiceRepository';
import { IMembershipEventRepository } from '../../../domain/repositories/IMembershipEventRepository';
import { IRenewalRequestRepository } from '../../../domain/repositories/IRenewalRequestRepository';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';
import { Client } from '../../../domain/entities/Client';
import { MembershipPlanType } from '../../../domain/entities/Gym';
import { calcularNuevoVencimiento } from '../../../domain/billing/planesMembresia';
import { AplicarRenovacionUseCase } from './AplicarRenovacionUseCase';

interface RenewClientDTO {
  clientId: string;
  gymId: string;
  /** Camino recomendado: resuelve monto y vencimiento desde `gym.membershipPlans`. */
  tipoPlan?: MembershipPlanType;
  /** Camino manual (venía de antes): para un monto que no calza con ningún plan
   *  del catálogo (una promo, un ajuste). Exige `nuevaFechaVencimiento` también. */
  monto?: number;
  nuevaFechaVencimiento?: Date;
}

/**
 * Renovación confirmada por el operador EN EL MOMENTO — cobro en efectivo o
 * transferencia, a diferencia de `payments/ProcessMercadoPagoWebhookUseCase`, que
 * confirma un pago recién cuando Mercado Pago avisa por webhook. Los dos aplican
 * la renovación real a través del mismo `AplicarRenovacionUseCase`.
 */
export class RenewClientUseCase {
  private readonly aplicarRenovacion: AplicarRenovacionUseCase;

  constructor(
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository,
    invoiceRepository: IInvoiceRepository,
    membershipEventRepository: IMembershipEventRepository,
    private renewalRequestRepository: IRenewalRequestRepository
  ) {
    this.aplicarRenovacion = new AplicarRenovacionUseCase(
      clientRepository,
      gymRepository,
      invoiceRepository,
      membershipEventRepository
    );
  }

  async execute(dto: RenewClientDTO): Promise<Client> {
    if (dto.tipoPlan === undefined && dto.monto === undefined) {
      throw new ValidationError('Hay que indicar monto o tipoPlan');
    }

    const client = await this.clientRepository.findById(dto.clientId, dto.gymId);
    if (!client) {
      throw new NotFoundError('Client');
    }

    let monto: number;
    let nuevaFechaVencimiento: Date;

    if (dto.tipoPlan !== undefined) {
      const gym = await this.gymRepository.findById(dto.gymId);
      const plan = gym?.membershipPlans.find((p) => p.tipo === dto.tipoPlan && p.activo);

      if (!plan) {
        throw new ValidationError(
          `El gimnasio no tiene configurado (o activo) el plan "${dto.tipoPlan}". Cargalo en Configuración > Planes.`
        );
      }

      monto = plan.monto;
      nuevaFechaVencimiento = calcularNuevoVencimiento(client.fechaVencimiento, plan.duracionDias);
    } else {
      if (dto.monto! <= 0) {
        throw new ValidationError('Monto debe ser positivo');
      }
      if (!dto.nuevaFechaVencimiento) {
        throw new ValidationError('Hay que indicar nuevaFechaVencimiento junto con monto');
      }
      monto = dto.monto!;
      nuevaFechaVencimiento = dto.nuevaFechaVencimiento;
    }

    // Un cobro confirmado reemplaza cualquier link de Mercado Pago que haya
    // quedado en el aire para este socio: si no se cancela, alguien podría pagar
    // ese link más tarde y el webhook aplicaría una segunda renovación sobre la
    // misma cuota.
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

    return this.aplicarRenovacion.execute({
      clientId: dto.clientId,
      gymId: dto.gymId,
      monto,
      nuevaFechaVencimiento
    });
  }
}

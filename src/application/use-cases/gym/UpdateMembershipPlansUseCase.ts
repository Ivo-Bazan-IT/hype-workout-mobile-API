import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Gym, MembershipPlan } from '../../../domain/entities/Gym';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface UpdateMembershipPlansDTO {
  gymId: string;
  planes: MembershipPlan[];
}

/**
 * Reemplaza el catálogo de precios completo del gym. Es el mismo catálogo que
 * alimenta tanto el link de Mercado Pago (`CreateRenewalPaymentLinkUseCase`) como
 * la renovación manual en efectivo (`RenewClientUseCase` con `tipoPlan`): un solo
 * lugar donde el dueño define cuánto sale cada plan, para que ningún operador
 * pueda cobrar un monto distinto por error.
 */
export class UpdateMembershipPlansUseCase {
  constructor(private gymRepository: IGymRepository) {}

  async execute(dto: UpdateMembershipPlansDTO): Promise<Gym> {
    const gym = await this.gymRepository.findById(dto.gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const tipos = dto.planes.map((plan) => plan.tipo);
    if (new Set(tipos).size !== tipos.length) {
      throw new ValidationError('No puede haber dos planes con el mismo tipo');
    }

    for (const plan of dto.planes) {
      if (plan.monto <= 0) {
        throw new ValidationError(`El plan "${plan.tipo}" necesita un monto positivo`);
      }
      if (plan.duracionDias <= 0) {
        throw new ValidationError(`El plan "${plan.tipo}" necesita una duración positiva`);
      }
    }

    const updated = await this.gymRepository.update(dto.gymId, { membershipPlans: dto.planes });
    return updated!;
  }
}

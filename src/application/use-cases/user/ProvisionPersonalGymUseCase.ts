import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError } from '../../../shared/errors/AppError';
import { GymTaxCondition } from '../../../domain/billing/types';

export class ProvisionPersonalGymUseCase {
  constructor(
    private userRepository: IUserRepository,
    private gymRepository: IGymRepository
  ) {}

  async execute(dto: { entrenadorUserId: string }): Promise<Gym> {
    const user = await this.userRepository.findById(dto.entrenadorUserId);
    if (!user) {
      throw new NotFoundError('User');
    }

    if (user.role !== 'entrenador') {
      throw new NotFoundError('Only entrenador users can have a personal gym');
    }

    const personalGym = await this.gymRepository.create({
      name: user.name,
      businessName: user.name,
      cuit: '',
      contactEmail: user.email,
      contactPhone: '',
      tipo: 'entrenador_independiente',
      ownerUserId: user.id,
      isActive: true,
      aiConfig: { provider: 'deepseek', promptTemplate: '' },
      whatsappConfig: { phoneNumberId: '', tokenSecretRef: '' },
      pdfTemplate: {},
      googleFormConfig: {},
      timezone: undefined,
      membershipPlans: [],
      afipConfig: { puntoVenta: 1, taxCondition: GymTaxCondition.MONOTRIBUTO, isActive: false },
    });

    await this.userRepository.update(user.id, { gymId: personalGym.id });
    return personalGym;
  }
}

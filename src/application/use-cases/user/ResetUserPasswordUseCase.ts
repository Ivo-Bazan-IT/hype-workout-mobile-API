import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { NotFoundError, ForbiddenError } from '../../../shared/errors/AppError';
import bcrypt from 'bcrypt';

interface ResetUserPasswordDTO {
  userId: string;
  password: string;
}

/**
 * Reset de contraseña por parte del super-admin: no exige la contraseña anterior
 * porque el actor no es el dueño de la cuenta. La ruta está detrás de requireAdmin.
 */
export class ResetUserPasswordUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(dto: ResetUserPasswordDTO): Promise<void> {
    const user = await this.userRepository.findById(dto.userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    if (user.role !== 'gym') {
      throw new ForbiddenError('Only gym owner users can be managed from this endpoint');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.userRepository.update(dto.userId, { passwordHash });
  }
}

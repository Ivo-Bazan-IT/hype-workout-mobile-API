import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { NotFoundError, ForbiddenError } from '../../../shared/errors/AppError';

interface DeleteUserDTO {
  userId: string;
}

/**
 * Soft delete: desactiva el usuario (isActive = false) siguiendo la convención del
 * proyecto (gyms y clients también se desactivan, no se borran). LoginUseCase ya
 * rechaza usuarios inactivos, así que esto corta el acceso de inmediato.
 */
export class DeleteUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(dto: DeleteUserDTO): Promise<void> {
    const user = await this.userRepository.findById(dto.userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    if (user.role !== 'gym') {
      throw new ForbiddenError('Only gym owner users can be managed from this endpoint');
    }

    await this.userRepository.update(dto.userId, { isActive: false });
  }
}

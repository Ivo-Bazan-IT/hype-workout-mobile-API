import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { User } from '../../../domain/entities/User';
import { NotFoundError, ConflictError, ForbiddenError } from '../../../shared/errors/AppError';

interface UpdateUserDTO {
  userId: string;
  email?: string;
  name?: string;
  isActive?: boolean;
  gymId?: string;
}

/**
 * Edita un usuario dueño de gym. El rol nunca es modificable: cambiar 'gym' por
 * 'admin' desde una API sería una escalada de privilegios.
 */
export class UpdateUserUseCase {
  constructor(
    private userRepository: IUserRepository,
    private gymRepository: IGymRepository
  ) {}

  async execute(dto: UpdateUserDTO): Promise<User> {
    const user = await this.userRepository.findById(dto.userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    if (user.role !== 'gym') {
      throw new ForbiddenError('Only gym owner users can be managed from this endpoint');
    }

    if (dto.email && dto.email.toLowerCase() !== user.email.toLowerCase()) {
      const existingUser = await this.userRepository.findByEmail(dto.email);
      if (existingUser) {
        throw new ConflictError('A user with this email already exists');
      }
    }

    if (dto.gymId && dto.gymId !== user.gymId) {
      const gym = await this.gymRepository.findById(dto.gymId);
      if (!gym) {
        throw new NotFoundError('Gym');
      }
    }

    const updatedUser = await this.userRepository.update(dto.userId, {
      email: dto.email,
      name: dto.name,
      isActive: dto.isActive,
      gymId: dto.gymId,
    });

    if (!updatedUser) {
      throw new NotFoundError('User');
    }

    return updatedUser;
  }
}

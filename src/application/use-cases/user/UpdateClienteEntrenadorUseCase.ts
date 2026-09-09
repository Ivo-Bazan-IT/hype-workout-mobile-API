import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { User } from '../../../domain/entities/User';
import { NotFoundError, ForbiddenError } from '../../../shared/errors/AppError';

interface UpdateClienteEntrenadorDTO {
  userId: string;
  entrenadorId?: string | null;
}

export class UpdateClienteEntrenadorUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(dto: UpdateClienteEntrenadorDTO): Promise<User> {
    const user = await this.userRepository.findById(dto.userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    if (user.role !== 'cliente') {
      throw new ForbiddenError('Only cliente users can update entrenador');
    }

    const updatedUser = await this.userRepository.update(dto.userId, {
      entrenadorId: dto.entrenadorId ?? null,
    });

    if (!updatedUser) {
      throw new NotFoundError('User');
    }

    return updatedUser;
  }
}

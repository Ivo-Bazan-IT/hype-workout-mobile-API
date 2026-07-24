import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { User } from '../../../domain/entities/User';
import { NotFoundError } from '../../../shared/errors/AppError';

interface GetUserDTO {
  userId: string;
}

export class GetUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(dto: GetUserDTO): Promise<User> {
    const user = await this.userRepository.findById(dto.userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    return user;
  }
}

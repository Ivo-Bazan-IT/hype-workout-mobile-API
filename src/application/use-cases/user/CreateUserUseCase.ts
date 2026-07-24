import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { User } from '../../../domain/entities/User';
import { NotFoundError, ConflictError } from '../../../shared/errors/AppError';
import bcrypt from 'bcrypt';

interface CreateUserDTO {
  email: string;
  password: string;
  name: string;
  gymId: string;
}

/**
 * Alta de un usuario dueño de gym. Solo crea usuarios con rol 'gym': los usuarios
 * 'admin' (super-admin de plataforma) se crean por el script de seed, nunca por API.
 */
export class CreateUserUseCase {
  constructor(
    private userRepository: IUserRepository,
    private gymRepository: IGymRepository
  ) {}

  async execute(dto: CreateUserDTO): Promise<User> {
    const gym = await this.gymRepository.findById(dto.gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const existingUser = await this.userRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictError('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    return this.userRepository.create({
      email: dto.email,
      passwordHash,
      role: 'gym',
      gymId: dto.gymId,
      name: dto.name,
      isActive: true,
    });
  }
}

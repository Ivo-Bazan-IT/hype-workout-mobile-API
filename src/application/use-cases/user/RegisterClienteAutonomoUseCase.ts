import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { User } from '../../../domain/entities/User';
import { ConflictError } from '../../../shared/errors/AppError';
import bcrypt from 'bcrypt';

export class RegisterClienteAutonomoUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(dto: { email: string; password: string; name: string }): Promise<User> {
    const existing = await this.userRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictError('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    return this.userRepository.create({
      email: dto.email,
      passwordHash,
      role: 'cliente',
      gymId: null,
      entrenadorId: null,
      name: dto.name,
      isActive: true,
    });
  }
}

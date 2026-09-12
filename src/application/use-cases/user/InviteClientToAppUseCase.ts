import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { Client } from '../../../domain/entities/Client';
import { NotFoundError, ConflictError } from '../../../shared/errors/AppError';
import bcrypt from 'bcrypt';

export class InviteClientToAppUseCase {
  constructor(
    private clientRepository: IClientRepository,
    private userRepository: IUserRepository
  ) {}

  async execute(dto: { clientId: string; gymId: string }): Promise<{ client: Client; user?: any }> {
    const client = await this.clientRepository.findById(dto.clientId, dto.gymId);
    if (!client) {
      throw new NotFoundError('Client');
    }

    if (client.userId) {
      // Ya tiene usuario vinculado: verificar que no esté vinculado a otra Client
      const existingClientWithSameUser = await this.clientRepository.findByUserId(client.userId, dto.gymId);
      // Si encuentra otro (no debería por índice único), lanzar conflicto
      if (existingClientWithSameUser && existingClientWithSameUser.id !== client.id) {
        throw new ConflictError('This user is already linked to another client');
      }
      return { client };
    }

    if (!client.email) {
      throw new ConflictError('Client needs an email to invite');
    }

    const existingUser = await this.userRepository.findByEmail(client.email);
    if (existingUser) {
      // Fusionar por email si el usuario existe y no está vinculado a otra Client
      if (existingUser.entrenadorId) {
        // Si el usuario ya tiene entrenador, asumimos que puede vincularse
      }
      await this.clientRepository.update(client.id, dto.gymId, { userId: existingUser.id });
      return { client: { ...client, userId: existingUser.id }, user: existingUser };
    }

    // Crear usuario con contraseña temporal aleatoria
    const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const newUser = await this.userRepository.create({
      email: client.email,
      passwordHash,
      role: 'cliente',
      gymId: null,
      entrenadorId: (await this.userRepository.findByEmail(client.email))?.id ?? null,
      name: client.nombre,
      isActive: true,
    });

    await this.clientRepository.update(client.id, dto.gymId, { userId: newUser.id, origenAlta: 'entrenador' });
    return { client: { ...client, userId: newUser.id }, user: newUser };
  }
}

import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { User } from '../../../domain/entities/User';
import { Client } from '../../../domain/entities/Client';
import { NotFoundError } from '../../../shared/errors/AppError';

export interface PendienteEncuesta {
  datos: Record<string, any>;
}

export class SeleccionarEntrenadorUseCase {
  constructor(
    private userRepository: IUserRepository,
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository
  ) {}

  async execute(dto: { clienteUserId: string; entrenadorId: string }): Promise<{ user: User; client?: Client }> {
    const cliente = await this.userRepository.findById(dto.clienteUserId);
    if (!cliente || cliente.role !== 'cliente') {
      throw new NotFoundError('Cliente user');
    }

    const entrenador = await this.userRepository.findById(dto.entrenadorId);
    if (!entrenador || entrenador.role !== 'entrenador') {
      throw new NotFoundError('Entrenador user');
    }

    const entrenadorGym = entrenador.gymId ? await this.gymRepository.findById(entrenador.gymId) : null;
    if (!entrenadorGym) {
      throw new NotFoundError('Entrenador gym');
    }

    // Actualizar el entrenador asociado al usuario cliente
    await this.userRepository.update(cliente.id, { entrenadorId: entrenador.id });

    // Verificar si ya existe una Client vinculada al usuario
    const existingClient = await this.clientRepository.findByUserId(cliente.id, entrenadorGym.id);

    if (existingClient) {
      await this.clientRepository.update(existingClient.id, entrenadorGym.id, {
        gymId: entrenadorGym.id,
      });
      return { user: await this.userRepository.findById(cliente.id) as User, client: existingClient };
    }

    // No existe Client: crear una nueva, copiando encuesta pendiente si existe
    // Nota: PendingSurvey se maneja fuera (en el controller) o aquí si se pasa
    return { user: await this.userRepository.findById(cliente.id) as User };
  }
}

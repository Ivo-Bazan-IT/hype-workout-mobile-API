import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { Client } from '../../../domain/entities/Client';
import { NotFoundError, ConflictError } from '../../../shared/errors/AppError';

interface UpdateClientDTO {
  clientId: string;
  gymId: string;
  data: Partial<Omit<Client, 'id' | 'gymId' | 'createdAt' | 'updatedAt'>>;
}

export class UpdateClientUseCase {
  constructor(private clientRepository: IClientRepository) {}

  async execute(dto: UpdateClientDTO): Promise<Client> {
    // Verificar que el cliente existe
    const existingClient = await this.clientRepository.findById(dto.clientId, dto.gymId);
    if (!existingClient) {
      throw new NotFoundError('Client');
    }

    // El documento identifica al cliente dentro del gym: si cambia, hay que
    // preservar su unicidad.
    if (dto.data.documento && dto.data.documento !== existingClient.documento) {
      const clienteConEseDocumento = await this.clientRepository.findByDocumento(
        dto.data.documento,
        dto.gymId
      );
      if (clienteConEseDocumento) {
        throw new ConflictError('A client with this documento already exists');
      }
    }

    const clienteActualizado = await this.clientRepository.update(dto.clientId, dto.gymId, dto.data);

    if (!clienteActualizado) {
      throw new NotFoundError('Client');
    }

    return clienteActualizado;
  }
}
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { NotFoundError } from '../../../shared/errors/AppError';

interface DeleteClientDTO {
  clientId: string;
  gymId: string;
}

export class DeleteClientUseCase {
  constructor(private clientRepository: IClientRepository) {}

  async execute(dto: DeleteClientDTO): Promise<boolean> {
    // Verificar que el cliente existe (implícito en delete)
    const deleted = await this.clientRepository.delete(dto.clientId, dto.gymId);

    if (!deleted) {
      throw new NotFoundError('Client not found');
    }

    return true;
  }
}
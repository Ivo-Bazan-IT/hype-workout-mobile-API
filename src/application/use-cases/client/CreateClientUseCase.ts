import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { Client } from '../../../domain/entities/Client';
import { ValidationError } from '../../../shared/errors/AppError';

interface CreateClientDTO {
  gymId: string;
  nombre: string;
  documento: string;
  telefono: string;
  email?: string;
  fechaInicio: Date;
  fechaVencimiento: Date;
  encuestaData?: Record<string, any>;
}

export class CreateClientUseCase {
  constructor(private clientRepository: IClientRepository) {}

  async execute(dto: CreateClientDTO): Promise<Client> {
    // Verificar documento único por gym
    const existingClient = await this.clientRepository.findByDocumento(dto.documento, dto.gymId);
    if (existingClient) {
      throw new ValidationError('A client with this documento already exists');
    }

    return this.clientRepository.create({
      gymId: dto.gymId,
      nombre: dto.nombre,
      documento: dto.documento,
      telefono: dto.telefono,
      email: dto.email,
      estado: 'activo',
      fechaInicio: dto.fechaInicio,
      fechaVencimiento: dto.fechaVencimiento,
      encuestaData: dto.encuestaData
    });
  }
}
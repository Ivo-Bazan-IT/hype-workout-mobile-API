import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { Client } from '../../../domain/entities/Client';
import { ValidationError } from '../../../shared/errors/AppError';

interface CreateClientDTO {
  gymId: string;
  nombre: string;
  documento: string;
  telefono?: string;
  email?: string;
  fechaInicio?: Date;
  fechaVencimiento?: Date;
  encuestaData?: Record<string, any>;
}

const DIAS_MEMBRESIA_POR_DEFECTO = 30;

/**
 * Alta de cliente. Solo `nombre` y `documento` son obligatorios: el resto de los
 * datos (teléfono, objetivos, entrenamientos por semana...) se completa después
 * con UpdateClientSurveyUseCase.
 */
export class CreateClientUseCase {
  constructor(private clientRepository: IClientRepository) {}

  async execute(dto: CreateClientDTO): Promise<Client> {
    // Verificar documento único por gym
    const existingClient = await this.clientRepository.findByDocumento(dto.documento, dto.gymId);
    if (existingClient) {
      throw new ValidationError('A client with this documento already exists');
    }

    const fechaInicio = dto.fechaInicio || new Date();

    let fechaVencimiento = dto.fechaVencimiento;
    if (!fechaVencimiento) {
      // Mismo criterio que el onboarding por formulario: 30 días desde el inicio
      fechaVencimiento = new Date(fechaInicio);
      fechaVencimiento.setDate(fechaVencimiento.getDate() + DIAS_MEMBRESIA_POR_DEFECTO);
    }

    return this.clientRepository.create({
      gymId: dto.gymId,
      nombre: dto.nombre,
      documento: dto.documento,
      telefono: dto.telefono,
      email: dto.email,
      estado: 'activo',
      fechaInicio,
      fechaVencimiento,
      encuestaData: dto.encuestaData
    });
  }
}

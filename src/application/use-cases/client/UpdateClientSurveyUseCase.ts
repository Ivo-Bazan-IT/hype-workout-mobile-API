import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { Client } from '../../../domain/entities/Client';
import { NotFoundError } from '../../../shared/errors/AppError';

interface UpdateClientSurveyDTO {
  clientId: string;
  gymId: string;
  telefono?: string;
  email?: string;
  encuestaData: Record<string, any>;
}

/**
 * Completa la encuesta de un cliente ya creado.
 *
 * Fusiona las respuestas nuevas sobre las ya cargadas en vez de reemplazarlas, para
 * poder completar la ficha en varias tandas sin perder lo anterior. Es el mismo
 * criterio que aplica ProcessFormSubmissionUseCase con las submissions de Google Forms.
 *
 * Los datos de contacto que llegan en la encuesta (teléfono, email) se promueven a
 * campos propios del cliente, porque el resto del sistema los usa desde ahí: el envío
 * de la rutina por WhatsApp lee `client.telefono`, no `encuestaData`.
 */
export class UpdateClientSurveyUseCase {
  constructor(private clientRepository: IClientRepository) {}

  async execute(dto: UpdateClientSurveyDTO): Promise<Client> {
    const existingClient = await this.clientRepository.findById(dto.clientId, dto.gymId);

    if (!existingClient) {
      throw new NotFoundError('Client');
    }

    const encuestaData = {
      ...(existingClient.encuestaData || {}),
      ...dto.encuestaData
    };

    const clienteActualizado = await this.clientRepository.update(dto.clientId, dto.gymId, {
      ...(dto.telefono !== undefined && { telefono: dto.telefono }),
      ...(dto.email !== undefined && { email: dto.email }),
      encuestaData
    });

    if (!clienteActualizado) {
      throw new NotFoundError('Client');
    }

    return clienteActualizado;
  }
}

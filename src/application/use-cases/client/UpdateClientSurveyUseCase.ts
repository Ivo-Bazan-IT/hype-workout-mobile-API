import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { Client, tieneEncuestaCompleta } from '../../../domain/entities/Client';
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
 *
 * Este es además el punto donde un lead se convierte en socio, así que sella
 * `fechaConversion` la primera vez. Como la ficha se completa en varias tandas, el
 * sello mira si YA había encuesta: sin esa guarda, la segunda tanda correría la
 * conversión al día en que se agregó el último campo.
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

    // Convierte solo si no había encuesta antes. Se mira `fechaConversion` además de
    // `encuestaData` para no re-sellar a los clientes que convirtieron antes de que
    // el campo existiera: para ellos la fecha es desconocida, y ponerles la de hoy
    // sería imputar al mes en curso una conversión de hace medio año.
    const conviertioAhora =
      !tieneEncuestaCompleta(existingClient.encuestaData) &&
      existingClient.fechaConversion === undefined &&
      tieneEncuestaCompleta(encuestaData);

    const clienteActualizado = await this.clientRepository.update(dto.clientId, dto.gymId, {
      ...(dto.telefono !== undefined && { telefono: dto.telefono }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(conviertioAhora && { fechaConversion: new Date() }),
      encuestaData
    });

    if (!clienteActualizado) {
      throw new NotFoundError('Client');
    }

    return clienteActualizado;
  }
}

import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { Client } from '../../../domain/entities/Client';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface RegisterFirstContactDTO {
  clientId: string;
  gymId: string;
  /**
   * Cuándo se lo contactó. Opcional: sin ella se toma el momento del request.
   * Existe porque el contacto real suele ser un llamado o un mensaje que se carga
   * al CRM más tarde, y ponerle la hora de la carga inflaría el tiempo de respuesta
   * con la demora administrativa en vez de medir la comercial.
   */
  fecha?: Date;
}

/**
 * Marca el primer contacto del gimnasio con un lead. Alimenta el KPI 4.3 (tiempo de
 * respuesta), que es una de las palancas más baratas del embudo: contestar rápido
 * sube la conversión sin costar plata.
 *
 * **Idempotente por diseño.** Si el lead ya estaba contactado, devuelve el cliente
 * sin tocar nada en vez de fallar. Un segundo llamado no es un error —es lo que pasa
 * cuando dos personas del mostrador atienden al mismo prospecto— pero sí tiene que
 * dejar en pie la fecha original: el KPI mide el PRIMER contacto, y dejar que el
 * último gane convertiría la métrica en "cuándo hablamos por última vez".
 */
export class RegisterFirstContactUseCase {
  constructor(private clientRepository: IClientRepository) {}

  async execute(dto: RegisterFirstContactDTO): Promise<Client> {
    const existingClient = await this.clientRepository.findById(dto.clientId, dto.gymId);

    if (!existingClient) {
      throw new NotFoundError('Client');
    }

    if (existingClient.fechaPrimerContacto !== undefined) {
      return existingClient;
    }

    const ahora = new Date();
    const fecha = dto.fecha ?? ahora;

    // Un contacto futuro daría un tiempo de respuesta negativo, y uno anterior al
    // alta mediría contra un lead que todavía no existía. Las dos cosas rompen el
    // promedio del KPI en silencio, así que se rechazan en vez de guardarse.
    if (fecha.getTime() > ahora.getTime()) {
      throw new ValidationError('fecha cannot be in the future');
    }

    if (fecha.getTime() < existingClient.createdAt.getTime()) {
      throw new ValidationError('fecha cannot be earlier than the client creation date');
    }

    const clienteActualizado = await this.clientRepository.update(dto.clientId, dto.gymId, {
      fechaPrimerContacto: fecha
    });

    if (!clienteActualizado) {
      throw new NotFoundError('Client');
    }

    return clienteActualizado;
  }
}

import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { Client } from '../../../domain/entities/Client';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface RegisterFormSentDTO {
  clientId: string;
  gymId: string;
}

/**
 * Deja asentado que se le mandó al socio el formulario de ingreso por WhatsApp.
 *
 * **El envío no sale de acá.** El mensaje lo dispara una persona desde su propio
 * WhatsApp (link `wa.me`), porque la Cloud API de Meta no permite escribirle primero
 * a alguien que no escribió antes salvo con una plantilla aprobada por Meta, y este
 * flujo es justamente el de mandarle el formulario a un socio que todavía no habló.
 * Este caso de uso registra la acción del operador, no la entrega del mensaje: por
 * eso el sello dice "cuándo se disparó desde el CRM" y no "cuándo lo recibió".
 *
 * Dos escrituras que responden a dos preguntas distintas:
 *
 *  1. `fechaFormularioEnviado` **se pisa siempre**. La pregunta que contesta el
 *     listado es "¿cuándo fue la última vez que le insistí?", así que un reenvío
 *     tiene que correr la fecha.
 *  2. `fechaPrimerContacto` **solo la primera vez**, con la misma regla que
 *     `RegisterFirstContactUseCase`: mandarle el formulario ES el primer contacto
 *     —sin esto el embudo sigue contando como "sin contactar" a un socio al que ya
 *     se le escribió— pero el KPI mide el PRIMER contacto y dejar ganar al último lo
 *     convertiría en "cuándo hablamos por última vez".
 */
export class RegisterFormSentUseCase {
  constructor(private clientRepository: IClientRepository) {}

  async execute(dto: RegisterFormSentDTO): Promise<Client> {
    const existingClient = await this.clientRepository.findById(dto.clientId, dto.gymId);

    if (!existingClient) {
      throw new NotFoundError('Client');
    }

    // Sin teléfono no hay a dónde mandarlo. Se valida acá y no solo en la pantalla
    // porque el sello miente si se guarda igual: la ficha diría "formulario enviado"
    // sobre un socio al que es imposible haberle mandado nada.
    if (!existingClient.telefono) {
      throw new ValidationError('Client has no phone number to send the form to');
    }

    const ahora = new Date();

    const clienteActualizado = await this.clientRepository.update(dto.clientId, dto.gymId, {
      fechaFormularioEnviado: ahora,
      ...(existingClient.fechaPrimerContacto === undefined && {
        fechaPrimerContacto: ahora,
      }),
    });

    if (!clienteActualizado) {
      throw new NotFoundError('Client');
    }

    return clienteActualizado;
  }
}

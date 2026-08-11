import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IMembershipEventRepository } from '../../../domain/repositories/IMembershipEventRepository';
import { Client, tieneEncuestaCompleta } from '../../../domain/entities/Client';
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
  constructor(
    private clientRepository: IClientRepository,
    private membershipEventRepository: IMembershipEventRepository
  ) {}

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

    const client = await this.clientRepository.create({
      gymId: dto.gymId,
      nombre: dto.nombre,
      documento: dto.documento,
      telefono: dto.telefono,
      email: dto.email,
      estado: 'activo',
      fechaInicio,
      fechaVencimiento,
      encuestaData: dto.encuestaData,
      // El alta que ya trae encuesta nunca fue un lead: nace convertida. La fecha
      // es la del alta y no `fechaInicio`, que puede venir retroactiva para que la
      // membresía arranque antes — el embudo mide cuándo entró el dato, no desde
      // cuándo corre la cuota.
      fechaConversion: tieneEncuestaCompleta(dto.encuestaData) ? new Date() : undefined
    });

    // Abre la primera ventana de membresía del socio. Sin este evento el socio no
    // existe para los KPIs: no cuenta como activo ni puede llegar a contar como baja.
    // El alta no lleva monto porque no registra cobro; la plata entra al renovar.
    await this.membershipEventRepository.create({
      gymId: client.gymId,
      clientId: client.id,
      tipo: 'alta',
      fecha: client.fechaInicio,
      vencimientoNuevo: client.fechaVencimiento,
      origen: 'operacion'
    });

    return client;
  }
}

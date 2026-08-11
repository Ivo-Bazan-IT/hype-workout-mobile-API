import { ICheckInRepository } from '../../../domain/repositories/ICheckInRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { CheckIn } from '../../../domain/entities/CheckIn';
import { ZONA_HORARIA_DEFAULT, limitesDelDiaEn } from '../../../domain/time/zonaHoraria';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface RegisterCheckInDTO {
  gymId: string;
  clientId: string;
  /** Momento del ingreso. Lo inyecta el borde HTTP; se acepta explícito para poder cargar una asistencia a mano. */
  fecha: Date;
}

/**
 * Registra el ingreso de un socio.
 *
 * Registra el hecho y no lo juzga: si un socio vencido entró, entró, y el dato vale
 * —de hecho es la señal de que volvió—. La única puerta que se cierra es la del
 * socio eliminado, que ya no es socio de nadie.
 */
export class RegisterCheckInUseCase {
  constructor(
    private checkInRepository: ICheckInRepository,
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository
  ) {}

  async execute(dto: RegisterCheckInDTO): Promise<CheckIn> {
    const client = await this.clientRepository.findById(dto.clientId, dto.gymId);

    if (!client) {
      throw new NotFoundError('Client');
    }

    if (client.estado === 'inactivo') {
      throw new ValidationError('Client is inactive');
    }

    // El día se corta en la zona del gimnasio, no en la del proceso Node. Cuesta una
    // lectura más por ingreso y vale la pena: con el server en UTC y el gym en
    // Argentina, un escaneo de las 21:30 caía en el día siguiente y el mismo socio
    // podía registrarse de nuevo a las 22:00 como si fuera otra visita.
    const gym = await this.gymRepository.findById(dto.gymId);
    const dia = limitesDelDiaEn(dto.fecha, gym?.timezone ?? ZONA_HORARIA_DEFAULT);

    // Idempotente por día: dos escaneos del mismo socio son una visita, no dos.
    // Se devuelve el registro existente en vez de lanzar un conflicto porque quien
    // llama suele ser un molinete o el mostrador, y ahí un error sería ruido.
    const yaRegistrado = await this.checkInRepository.findByClientAndDay(
      dto.clientId,
      dto.gymId,
      dia
    );

    if (yaRegistrado) {
      return yaRegistrado;
    }

    return this.checkInRepository.create({
      gymId: dto.gymId,
      clientId: dto.clientId,
      fecha: dto.fecha,
    });
  }
}

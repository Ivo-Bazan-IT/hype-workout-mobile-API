import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IEncryptionService } from '../../../domain/services/IEncryptionService';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface UpdateAfipCredentialsDTO {
  gymId: string;
  /** Access token de la cuenta de AFIP SDK del gym (app.afipsdk.com). */
  apiKey?: string;
  /** Contenido del archivo .crt del gym, tal cual lo entrega AFIP. */
  cert?: string;
  /** Contenido del archivo .key del gym. */
  key?: string;
}

/**
 * Carga o rota la credencial de la cuenta PROPIA de AFIP SDK del gym: access
 * token + certificado + clave privada. Separado de `UpdateAfipConfigUseCase`
 * (que maneja cuit/puntoVenta/taxCondition/isActive) porque este viene de un
 * endpoint multipart y los otros de un PUT en JSON — mezclarlos forzaría a
 * todo el resto de `afipConfig` a viajar como texto también.
 *
 * Igual que `UpdateAiConfigUseCase`: MERGE sobre lo existente, así que se puede
 * rotar una sola de las tres credenciales sin tener que resubir las otras dos.
 */
export class UpdateAfipCredentialsUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private encryptionService: IEncryptionService
  ) {}

  async execute(dto: UpdateAfipCredentialsDTO): Promise<Gym> {
    if (dto.apiKey === undefined && dto.cert === undefined && dto.key === undefined) {
      throw new ValidationError('Hay que enviar al menos una credencial (apiKey, cert o key)');
    }

    // Un .crt/.key vacío o que no es texto PEM rompe recién al emitir, contra AFIP
    // real: mejor cortarlo acá, donde todavía se puede corregir sin quemar un intento.
    if (dto.cert !== undefined && !dto.cert.includes('BEGIN CERTIFICATE')) {
      throw new ValidationError('El archivo .crt no tiene forma de certificado PEM (falta "BEGIN CERTIFICATE")');
    }
    if (dto.key !== undefined && !dto.key.includes('PRIVATE KEY')) {
      throw new ValidationError('El archivo .key no tiene forma de clave privada PEM (falta "PRIVATE KEY")');
    }

    const gym = await this.gymRepository.findById(dto.gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const afipConfigActual = gym.afipConfig;
    if (!afipConfigActual) {
      throw new ValidationError(
        'El gimnasio todavía no tiene configurada su identidad fiscal (CUIT/punto de venta/condición). Cargá eso primero.'
      );
    }

    const updatedGym = await this.gymRepository.update(dto.gymId, {
      afipConfig: {
        ...afipConfigActual,
        ...(dto.apiKey !== undefined && { encryptedApiKey: this.encryptionService.encrypt(dto.apiKey) }),
        ...(dto.cert !== undefined && { encryptedCert: this.encryptionService.encrypt(dto.cert) }),
        ...(dto.key !== undefined && { encryptedKey: this.encryptionService.encrypt(dto.key) }),
        credencialesActualizadasEn: new Date()
      }
    });

    return updatedGym!;
  }
}

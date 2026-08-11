import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IFormSubmissionRecordRepository } from '../../../domain/repositories/IFormSubmissionRecordRepository';
import { NotFoundError } from '../../../shared/errors/AppError';

interface GetOnboardingStatusDTO {
  gymId: string;
}

export interface OnboardingStatus {
  /**
   * Si el gym tiene secreto de webhook configurado. Es lo único que se puede
   * afirmar sobre la instalación desde este lado: el trigger vive en Google y el
   * backend no puede consultarlo.
   */
  configurado: boolean;
  /** Título de la pregunta del Form mapeada a cada campo, si el gym lo declaró. */
  fieldMapping: Record<string, string> | null;
  submissions: {
    total: number;
    procesadas: number;
    rechazadas: number;
    /**
     * Cuándo llegó la última submission, o `null` si nunca llegó ninguna.
     *
     * Reemplaza al `lastSync: new Date()` que devolvía el stub: ese timestamp decía
     * "recién sincronizado" incluso con el trigger desinstalado hace meses, que es
     * la única situación en la que a alguien se le ocurre mirar este endpoint.
     */
    ultimaRecibidaEn: Date | null;
    ultimoResultado: 'procesada' | 'rechazada' | null;
  };
  /**
   * Las últimas que rebotaron, para poder actuar: casi siempre es un DNI que el
   * socio tipeó mal o un alta que todavía no se hizo.
   */
  ultimosRechazos: Array<{
    documento: string | null;
    motivo: string | null;
    recibidaEn: Date;
  }>;
}

/** Cuántos rechazos recientes se devuelven. Es una lista para revisar, no un log. */
const RECHAZOS_A_MOSTRAR = 10;

/**
 * Estado real de la integración con el formulario de ingreso.
 *
 * Antes esto era un stub que devolvía `lastSync: new Date()` y el texto "Webhook
 * endpoint active", o sea que informaba "todo bien" sin haber consultado nada. Ahora
 * sale de las submissions efectivamente recibidas.
 */
export class GetOnboardingStatusUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private submissionRecordRepository: IFormSubmissionRecordRepository
  ) {}

  async execute(dto: GetOnboardingStatusDTO): Promise<OnboardingStatus> {
    const gym = await this.gymRepository.findById(dto.gymId);

    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const stats = await this.submissionRecordRepository.getStats(
      dto.gymId,
      RECHAZOS_A_MOSTRAR
    );

    const mapping = gym.googleFormConfig?.fieldMapping;

    return {
      // El hash del secreto NO se devuelve, solo si existe: alcanza para responder
      // "¿está configurado?" sin exponer material del que se pueda derivar el secreto.
      configurado: Boolean(gym.googleFormConfig?.webhookSecretHash),
      fieldMapping:
        mapping && Object.keys(mapping).length > 0
          ? (mapping as Record<string, string>)
          : null,
      submissions: {
        total: stats.total,
        procesadas: stats.procesadas,
        rechazadas: stats.rechazadas,
        ultimaRecibidaEn: stats.ultima?.recibidaEn ?? null,
        ultimoResultado: stats.ultima?.resultado ?? null,
      },
      ultimosRechazos: stats.ultimosRechazos.map((r) => ({
        documento: r.documento ?? null,
        motivo: r.motivo ?? null,
        recibidaEn: r.recibidaEn,
      })),
    };
  }
}

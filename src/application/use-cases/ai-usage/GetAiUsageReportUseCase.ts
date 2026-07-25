import { IAiUsageRepository, AiUsageReport } from '../../../domain/repositories/IAiUsageRepository';
import { ValidationError } from '../../../shared/errors/AppError';

interface GetAiUsageReportDTO {
  gymId: string;
  desde?: Date;
  hasta?: Date;
}

/** Período por defecto cuando el front no manda fechas: los últimos 12 meses. */
const MESES_POR_DEFECTO = 12;

/**
 * Cuánto consumió de IA un gym en un período, con desglose por mes y por modelo.
 *
 * Es la base para tarifar: sin esto no hay forma de saber qué gym se dispara ni
 * cuánto cuesta atenderlo.
 */
export class GetAiUsageReportUseCase {
  constructor(private aiUsageRepository: IAiUsageRepository) {}

  async execute(dto: GetAiUsageReportDTO): Promise<AiUsageReport> {
    const hasta = dto.hasta ?? new Date();

    const desde =
      dto.desde ??
      (() => {
        const inicio = new Date(hasta);
        inicio.setMonth(inicio.getMonth() - MESES_POR_DEFECTO);
        return inicio;
      })();

    if (desde > hasta) {
      throw new ValidationError('desde cannot be later than hasta');
    }

    return this.aiUsageRepository.getUsageByPeriod(dto.gymId, desde, hasta);
  }
}

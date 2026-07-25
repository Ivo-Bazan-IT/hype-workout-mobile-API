import { IInvoiceRepository, RevenueReport } from '../../../domain/repositories/IInvoiceRepository';
import { ValidationError } from '../../../shared/errors/AppError';

interface GetRevenueReportDTO {
  gymId: string;
  desde?: Date;
  hasta?: Date;
}

/** Período por defecto cuando el front no manda fechas: los últimos 12 meses. */
const MESES_POR_DEFECTO = 12;

/**
 * Reporte de ingresos de un período, con desglose mensual.
 *
 * Generaliza el `sumRevenueByMonth` que hasta ahora solo alimentaba el KPI de
 * mes actual / mes previo del dashboard.
 */
export class GetRevenueReportUseCase {
  constructor(private invoiceRepository: IInvoiceRepository) {}

  async execute(dto: GetRevenueReportDTO): Promise<RevenueReport> {
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

    return this.invoiceRepository.getRevenueByPeriod(dto.gymId, desde, hasta);
  }
}

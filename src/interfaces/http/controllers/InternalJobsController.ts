import { Request, Response, NextFunction } from 'express';
import { EmitPendingInvoicesUseCase } from '../../../application/use-cases/invoice/EmitPendingInvoicesUseCase';
import { env } from '../../../config/env';
import { CheckWeeklyUpdatesUseCase } from '../../../application/use-cases/internal/CheckWeeklyUpdatesUseCase';

/**
 * Disparadores de trabajo en segundo plano para un cron externo.
 *
 * Es el mismo trabajo que hace `InvoiceEmissionScheduler`, entrando por HTTP en vez
 * de por temporizador. Puede convivir con él —el lease de `claimPendiente` impide
 * que dos corridas se lleven la misma factura— pero en la práctica se usa uno u
 * otro, según `INVOICE_WORKER_MODE`.
 */
export class InternalJobsController {
  constructor(
    private emitPendingInvoices: EmitPendingInvoicesUseCase,
    private checkWeeklyUpdatesUseCase: CheckWeeklyUpdatesUseCase
  ) {}

  async checkWeeklyUpdates(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const resumen = await this.checkWeeklyUpdatesUseCase.execute('');
      res.json({
        status: 'success',
        data: resumen
      });
    } catch (error) {
      next(error);
    }
  }

  async emitInvoices(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const resumen = await this.emitPendingInvoices.execute({
        maxFacturas: env.INVOICE_JOB_MAX
      });

      // El resumen se devuelve entero para que el cron externo sirva de monitoreo:
      // `truncado: true` sostenido en el tiempo significa que la cadencia configurada
      // no da abasto con el volumen y hay que acortar el intervalo.
      res.json({
        status: 'success',
        data: resumen
      });
    } catch (error) {
      next(error);
    }
  }
}

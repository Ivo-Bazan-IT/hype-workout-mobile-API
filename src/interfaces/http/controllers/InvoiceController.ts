import { Response, NextFunction } from 'express';
import { SearchInvoicesUseCase } from '../../../application/use-cases/invoice/SearchInvoicesUseCase';
import { GetRevenueReportUseCase } from '../../../application/use-cases/invoice/GetRevenueReportUseCase';
import { RetryInvoiceUseCase } from '../../../application/use-cases/invoice/RetryInvoiceUseCase';
import { IInvoiceRepository } from '../../../domain/repositories/IInvoiceRepository';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';
import { NotFoundError } from '../../../shared/errors/AppError';

export class InvoiceController {
  constructor(
    private searchInvoicesUseCase: SearchInvoicesUseCase,
    private getRevenueReportUseCase: GetRevenueReportUseCase,
    private retryInvoiceUseCase: RetryInvoiceUseCase,
    private invoiceRepository: IInvoiceRepository
  ) {}

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const filters = {
        clientId: req.query.clientId as string | undefined,
        estado: req.query.estado as 'emitida' | 'anulada' | 'error' | 'pendiente' | undefined,
        tipoComprobante: req.query.tipoComprobante as string | undefined,
        cae: req.query.cae as string | undefined,
        emitidaDesde: req.query.emitidaDesde as Date | undefined,
        emitidaHasta: req.query.emitidaHasta as Date | undefined
      };

      const result = await this.searchInvoicesUseCase.execute({
        gymId,
        filters,
        page: req.query.page as number | undefined,
        limit: req.query.limit as number | undefined
      });

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async getRevenue(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const report = await this.getRevenueReportUseCase.execute({
        gymId,
        desde: req.query.desde as Date | undefined,
        hasta: req.query.hasta as Date | undefined
      });

      res.json({
        status: 'success',
        data: report
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const gymId = getTenantId(req);

      const invoice = await this.invoiceRepository.findById(id, gymId);

      if (!invoice) {
        throw new NotFoundError('Invoice');
      }

      res.json({
        status: 'success',
        data: invoice
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reencola una factura que quedó en error. Responde enseguida con la factura ya
   * en `pendiente`: la emisión la hace el worker, así que este endpoint no espera a
   * AFIP ni puede confirmar que el comprobante salió.
   */
  async retry(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const gymId = getTenantId(req);

      const invoice = await this.retryInvoiceUseCase.execute({ invoiceId: id, gymId });

      res.json({
        status: 'success',
        data: invoice,
        message: 'La factura volvió a la cola de emisión.'
      });
    } catch (error) {
      next(error);
    }
  }
}

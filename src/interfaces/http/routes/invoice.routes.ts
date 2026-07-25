import { Router } from 'express';
import { MongoInvoiceRepository } from '../../../infrastructure/database/mongoose/repositories/MongoInvoiceRepository';
import { SearchInvoicesUseCase } from '../../../application/use-cases/invoice/SearchInvoicesUseCase';
import { GetRevenueReportUseCase } from '../../../application/use-cases/invoice/GetRevenueReportUseCase';
import { InvoiceController } from '../controllers/InvoiceController';
import { searchInvoicesSchema, revenueReportSchema } from '../validators/invoice.validator';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

// Middleware para validar query params
function validateQuery(schema: z.ZodSchema<any>) {
  return (req: any, _res: any, next: any) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const createInvoiceRoutes = () => {
  const router = Router();

  // Adaptadores concretos: ÚNICO lugar donde se instancia infraestructura
  const invoiceRepository = new MongoInvoiceRepository();

  // Casos de uso: reciben solo puertos
  const searchInvoicesUseCase = new SearchInvoicesUseCase(invoiceRepository);
  const getRevenueReportUseCase = new GetRevenueReportUseCase(invoiceRepository);

  const invoiceController = new InvoiceController(
    searchInvoicesUseCase,
    getRevenueReportUseCase,
    invoiceRepository
  );

  // GET /api/invoices - Historial de facturación (paginado + filtros)
  router.get('/', validateQuery(searchInvoicesSchema), (req, res, next) =>
    invoiceController.list(req as AuthenticatedRequest, res, next)
  );

  // GET /api/invoices/revenue - Reporte de ingresos por período.
  // Va ANTES de /:id: Express matchea en orden de registro y si no, "revenue"
  // caería como id y devolvería 404.
  router.get('/revenue', validateQuery(revenueReportSchema), (req, res, next) =>
    invoiceController.getRevenue(req as AuthenticatedRequest, res, next)
  );

  // GET /api/invoices/:id - Detalle de un comprobante
  router.get('/:id', (req, res, next) =>
    invoiceController.get(req as AuthenticatedRequest, res, next)
  );

  return router;
};

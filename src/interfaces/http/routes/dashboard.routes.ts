import { Router } from 'express';
import { z } from 'zod';
import { DashboardController } from '../controllers/DashboardController';
import { GetGymDashboardUseCase } from '../../../application/use-cases/dashboard/GetGymDashboardUseCase';
import { GetGymKpisUseCase } from '../../../application/use-cases/dashboard/GetGymKpisUseCase';
import { GetGymKpisSeriesUseCase } from '../../../application/use-cases/dashboard/GetGymKpisSeriesUseCase';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { MongoRoutineRepository } from '../../../infrastructure/database/mongoose/repositories/MongoRoutineRepository';
import { MongoInvoiceRepository } from '../../../infrastructure/database/mongoose/repositories/MongoInvoiceRepository';
import { MongoMetricsRepository } from '../../../infrastructure/database/mongoose/repositories/MongoMetricsRepository';
import {
  gymKpisQuerySchema,
  gymKpisSeriesQuerySchema,
} from '../validators/dashboard.validator';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { requireAdmin } from '../middlewares/roleMiddleware';

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

export const createDashboardRouter = () => {
  const router = Router();

  const clientRepository = new MongoClientRepository();
  const routineRepository = new MongoRoutineRepository();
  const invoiceRepository = new MongoInvoiceRepository();
  const metricsRepository = new MongoMetricsRepository();

  const getGymDashboardUseCase = new GetGymDashboardUseCase(
    clientRepository,
    routineRepository,
    invoiceRepository
  );

  const getGymKpisUseCase = new GetGymKpisUseCase(metricsRepository);
  const getGymKpisSeriesUseCase = new GetGymKpisSeriesUseCase(metricsRepository);

  const dashboardController = new DashboardController(
    getGymDashboardUseCase,
    getGymKpisUseCase,
    getGymKpisSeriesUseCase
  );

  // GET /api/dashboard - Métricas del gym logueado (o gym específico para admin)
  router.get('/', tenantMiddleware, (req, res, next) =>
    dashboardController.get(req as AuthenticatedRequest, res, next)
  );

  // GET /api/dashboard/kpis - KPIs de retención y financieros.
  // Endpoint aparte y no una extensión de `/`: el dashboard actual ya lo consume el
  // front y estos KPIs tienen otro contrato (período configurable, valores en null
  // cuando el dato no existe).
  router.get(
    '/kpis',
    tenantMiddleware,
    validateQuery(gymKpisQuerySchema),
    (req, res, next) => dashboardController.getKpis(req as AuthenticatedRequest, res, next)
  );

  // GET /api/dashboard/kpis/series - Evolución mensual de los KPIs.
  //
  // Va DESPUÉS de /kpis pero antes de cualquier /kpis/:algo que se agregue: Express
  // matchea en orden de registro y un parámetro se comería "series".
  router.get(
    '/kpis/series',
    tenantMiddleware,
    validateQuery(gymKpisSeriesQuerySchema),
    (req, res, next) =>
      dashboardController.getKpisSeries(req as AuthenticatedRequest, res, next)
  );

  // GET /api/dashboard/summary - Solo admin - resumen de todos los gyms.
  // NO lleva tenantMiddleware a propósito: es el único endpoint deliberadamente
  // cross-gym, así que exigirle un ?gymId= lo dejaría sin sentido.
  router.get('/summary', requireAdmin, (req, res, next) =>
    dashboardController.getSummary(req as AuthenticatedRequest, res, next)
  );

  return router;
};

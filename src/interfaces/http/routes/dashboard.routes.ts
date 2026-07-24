import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { GetGymDashboardUseCase } from '../../../application/use-cases/dashboard/GetGymDashboardUseCase';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { MongoRoutineRepository } from '../../../infrastructure/database/mongoose/repositories/MongoRoutineRepository';
import { MongoInvoiceRepository } from '../../../infrastructure/database/mongoose/repositories/MongoInvoiceRepository';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export const createDashboardRouter = () => {
  const router = Router();

  const clientRepository = new MongoClientRepository();
  const routineRepository = new MongoRoutineRepository();
  const invoiceRepository = new MongoInvoiceRepository();

  const getGymDashboardUseCase = new GetGymDashboardUseCase(
    clientRepository,
    routineRepository,
    invoiceRepository
  );

  const dashboardController = new DashboardController(getGymDashboardUseCase);

  // GET /api/dashboard - Métricas del gym logueado (o gym específico para admin)
  router.get('/', (req, res, next) =>
    dashboardController.get(req as AuthenticatedRequest, res, next)
  );

  // GET /api/dashboard/summary - Solo admin - resumen de todos los gyms
  router.get('/summary', (req, res, next) =>
    dashboardController.getSummary(req as AuthenticatedRequest, res, next)
  );

  return router;
};
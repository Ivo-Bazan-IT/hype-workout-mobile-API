import { Router } from 'express';
import { z } from 'zod';
import { CheckInController } from '../controllers/CheckInController';
import { RegisterCheckInUseCase } from '../../../application/use-cases/checkin/RegisterCheckInUseCase';
import { SearchCheckInsUseCase } from '../../../application/use-cases/checkin/SearchCheckInsUseCase';
import { GetCheckInHeatmapUseCase } from '../../../application/use-cases/checkin/GetCheckInHeatmapUseCase';
import { MongoCheckInRepository } from '../../../infrastructure/database/mongoose/repositories/MongoCheckInRepository';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoMetricsRepository } from '../../../infrastructure/database/mongoose/repositories/MongoMetricsRepository';
import {
  checkInHeatmapSchema,
  registerCheckInSchema,
  searchCheckInsSchema,
} from '../validators/checkin.validator';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

function validateBody(schema: z.ZodSchema<any>) {
  return (req: any, _res: any, next: any) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

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

export const createCheckInRoutes = () => {
  const router = Router();

  const checkInRepository = new MongoCheckInRepository();
  const clientRepository = new MongoClientRepository();
  // Para resolver la zona horaria del gimnasio, que es la que decide qué día
  // calendario le corresponde a un ingreso.
  const gymRepository = new MongoGymRepository();

  const registerCheckInUseCase = new RegisterCheckInUseCase(
    checkInRepository,
    clientRepository,
    gymRepository
  );
  const searchCheckInsUseCase = new SearchCheckInsUseCase(checkInRepository);
  // `registroDesde` sale del mismo puerto que lo expone en /dashboard/kpis.
  const metricsRepository = new MongoMetricsRepository();
  const getCheckInHeatmapUseCase = new GetCheckInHeatmapUseCase(
    checkInRepository,
    gymRepository,
    metricsRepository
  );

  const checkInController = new CheckInController(
    registerCheckInUseCase,
    searchCheckInsUseCase,
    getCheckInHeatmapUseCase
  );

  // POST /api/checkins - Registrar el ingreso de un socio
  router.post('/', validateBody(registerCheckInSchema), (req, res, next) =>
    checkInController.register(req as AuthenticatedRequest, res, next)
  );

  // GET /api/checkins/heatmap - La semana del gym en una grilla día × hora.
  //
  // Va ANTES de cualquier /:id que se agregue: Express matchea en orden de registro
  // y "heatmap" caería como parámetro, devolviendo un 404 difícil de explicar.
  router.get('/heatmap', validateQuery(checkInHeatmapSchema), (req, res, next) =>
    checkInController.heatmap(req as AuthenticatedRequest, res, next)
  );

  // GET /api/checkins - Historial de asistencia, filtrable por socio y período
  router.get('/', validateQuery(searchCheckInsSchema), (req, res, next) =>
    checkInController.list(req as AuthenticatedRequest, res, next)
  );

  return router;
};

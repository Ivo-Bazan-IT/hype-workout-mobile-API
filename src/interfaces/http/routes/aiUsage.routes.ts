import { Router } from 'express';
import { MongoAiUsageRepository } from '../../../infrastructure/database/mongoose/repositories/MongoAiUsageRepository';
import { SearchAiUsageUseCase } from '../../../application/use-cases/ai-usage/SearchAiUsageUseCase';
import { GetAiUsageReportUseCase } from '../../../application/use-cases/ai-usage/GetAiUsageReportUseCase';
import { AiUsageController } from '../controllers/AiUsageController';
import { searchAiUsageSchema, aiUsageReportSchema } from '../validators/aiUsage.validator';
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

export const createAiUsageRoutes = () => {
  const router = Router();

  // Adaptadores concretos: ÚNICO lugar donde se instancia infraestructura
  const aiUsageRepository = new MongoAiUsageRepository();

  // Casos de uso: reciben solo puertos
  const searchAiUsageUseCase = new SearchAiUsageUseCase(aiUsageRepository);
  const getAiUsageReportUseCase = new GetAiUsageReportUseCase(aiUsageRepository);

  const aiUsageController = new AiUsageController(searchAiUsageUseCase, getAiUsageReportUseCase);

  // GET /api/ai-usage - Detalle del consumo, rutina por rutina
  router.get('/', validateQuery(searchAiUsageSchema), (req, res, next) =>
    aiUsageController.list(req as AuthenticatedRequest, res, next)
  );

  // GET /api/ai-usage/report - Agregado por período, con desglose por mes y modelo
  router.get('/report', validateQuery(aiUsageReportSchema), (req, res, next) =>
    aiUsageController.getReport(req as AuthenticatedRequest, res, next)
  );

  return router;
};

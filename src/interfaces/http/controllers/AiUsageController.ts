import { Response, NextFunction } from 'express';
import { SearchAiUsageUseCase } from '../../../application/use-cases/ai-usage/SearchAiUsageUseCase';
import { GetAiUsageReportUseCase } from '../../../application/use-cases/ai-usage/GetAiUsageReportUseCase';
import { AiProvider } from '../../../domain/entities/Gym';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';

export class AiUsageController {
  constructor(
    private searchAiUsageUseCase: SearchAiUsageUseCase,
    private getAiUsageReportUseCase: GetAiUsageReportUseCase
  ) {}

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const filters = {
        clientId: req.query.clientId as string | undefined,
        routineId: req.query.routineId as string | undefined,
        provider: req.query.provider as AiProvider | undefined,
        model: req.query.model as string | undefined,
        desde: req.query.desde as Date | undefined,
        hasta: req.query.hasta as Date | undefined
      };

      const result = await this.searchAiUsageUseCase.execute({
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

  async getReport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const report = await this.getAiUsageReportUseCase.execute({
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
}

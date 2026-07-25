import { Response, NextFunction } from 'express';
import { GetGymDashboardUseCase } from '../../../application/use-cases/dashboard/GetGymDashboardUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';

export class DashboardController {
  constructor(private getGymDashboardUseCase: GetGymDashboardUseCase) {}

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const metrics = await this.getGymDashboardUseCase.execute(gymId);

      res.json({
        status: 'success',
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }

  async getSummary(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // El rol ya lo garantiza `requireAdmin` en la ruta; no se re-chequea acá.

      // Placeholder - se implementaría agregación de todos los gyms
      res.json({
        status: 'success',
        data: {
          message: 'Summary endpoint - implement aggregation across all gyms'
        }
      });
    } catch (error) {
      next(error);
    }
  }
}
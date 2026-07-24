import { Response, NextFunction } from 'express';
import { GetGymDashboardUseCase } from '../../../application/use-cases/dashboard/GetGymDashboardUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class DashboardController {
  constructor(private getGymDashboardUseCase: GetGymDashboardUseCase) {}

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;

      const gymId = user?.role === 'admin' && req.query.gymId
        ? (req.query.gymId as string)
        : user?.gymId;

      if (!gymId) {
        res.status(403).json({
          status: 'error',
          message: 'Gym access required'
        });
        return;
      }

      const metrics = await this.getGymDashboardUseCase.execute(gymId);

      res.json({
        status: 'success',
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }

  async getSummary(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;

      // Solo admin puede ver resumen de todos los gyms
      if (user?.role !== 'admin') {
        res.status(403).json({
          status: 'error',
          message: 'Admin access required'
        });
        return;
      }

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
import { Request, Response, NextFunction } from 'express';
import { CreateGymUseCase } from '../../../application/use-cases/gym/CreateGymUseCase';
import { UpdateGymUseCase } from '../../../application/use-cases/gym/UpdateGymUseCase';
import { DeleteGymUseCase } from '../../../application/use-cases/gym/DeleteGymUseCase';
import { ListGymsUseCase } from '../../../application/use-cases/gym/ListGymsUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class GymController {
  constructor(
    private createGymUseCase: CreateGymUseCase,
    private updateGymUseCase: UpdateGymUseCase,
    private deleteGymUseCase: DeleteGymUseCase,
    private listGymsUseCase: ListGymsUseCase
  ) {}

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.createGymUseCase.execute(req.body);

      res.status(201).json({
        status: 'success',
        data: {
          gym: {
            id: result.gym.id,
            name: result.gym.name,
            businessName: result.gym.businessName,
            cuit: result.gym.cuit,
          },
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const gyms = await this.listGymsUseCase.execute();

      res.json({
        status: 'success',
        data: gyms.map(gym => ({
          id: gym.id,
          name: gym.name,
          businessName: gym.businessName,
          cuit: gym.cuit,
          contactEmail: gym.contactEmail,
          contactPhone: gym.contactPhone,
          isActive: gym.isActive,
          // El dashboard de plataforma cuenta las altas del mes y ordena las
          // últimas por fecha: sin `createdAt` en la proyección esas métricas
          // daban 0 aunque el dato estuviera en la base.
          createdAt: gym.createdAt,
          updatedAt: gym.updatedAt,
        }))
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      // El gym ya está verificado por middleware en rutas
      // Aquí iría lógica para obtener por ID si se implementa IGymRepository.getById
      res.json({
        status: 'success',
        data: { id } // Placeholder
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await this.updateGymUseCase.execute(id, req.body);

      if (!result) {
        res.status(404).json({
          status: 'error',
          message: 'Gym not found'
        });
        return;
      }

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const success = await this.deleteGymUseCase.execute(id);

      if (!success) {
        res.status(404).json({
          status: 'error',
          message: 'Gym not found'
        });
        return;
      }

      res.json({
        status: 'success',
        message: 'Gym deactivated successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}
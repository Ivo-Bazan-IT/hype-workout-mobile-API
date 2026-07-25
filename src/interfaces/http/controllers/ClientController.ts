import { Response, NextFunction } from 'express';
import { CreateClientUseCase } from '../../../application/use-cases/client/CreateClientUseCase';
import { SearchClientsUseCase } from '../../../application/use-cases/client/SearchClientsUseCase';
import { UpdateClientUseCase } from '../../../application/use-cases/client/UpdateClientUseCase';
import { DeleteClientUseCase } from '../../../application/use-cases/client/DeleteClientUseCase';
import { RenewClientUseCase } from '../../../application/use-cases/client/RenewClientUseCase';
import { UpdateClientSurveyUseCase } from '../../../application/use-cases/client/UpdateClientSurveyUseCase';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';
import { NotFoundError } from '../../../shared/errors/AppError';

export class ClientController {
  constructor(
    private createClientUseCase: CreateClientUseCase,
    private searchClientsUseCase: SearchClientsUseCase,
    private updateClientUseCase: UpdateClientUseCase,
    private deleteClientUseCase: DeleteClientUseCase,
    private renewClientUseCase: RenewClientUseCase,
    private updateClientSurveyUseCase: UpdateClientSurveyUseCase,
    private clientRepository: IClientRepository
  ) {}

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const result = await this.createClientUseCase.execute({
        ...req.body,
        gymId
      });

      res.status(201).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const filters = {
        query: req.query.query as string | undefined,
        estado: req.query.estado as 'activo' | 'inactivo' | 'pendiente' | undefined
      };

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await this.searchClientsUseCase.execute({
        gymId,
        filters,
        page,
        limit
      });

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async search(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const filters = {
        query: req.query.q as string | undefined,
        estado: req.query.estado as 'activo' | 'inactivo' | 'pendiente' | undefined
      };

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await this.searchClientsUseCase.execute({
        gymId,
        filters,
        page,
        limit
      });

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const gymId = getTenantId(req);

      const client = await this.clientRepository.findById(id, gymId);

      if (!client) {
        throw new NotFoundError('Client');
      }

      res.json({
        status: 'success',
        data: client
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const gymId = getTenantId(req);

      const result = await this.updateClientUseCase.execute({
        clientId: id,
        gymId,
        data: req.body
      });

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
      const gymId = getTenantId(req);

      await this.deleteClientUseCase.execute({
        clientId: id,
        gymId
      });

      res.json({
        status: 'success',
        message: 'Client deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async updateSurvey(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const gymId = getTenantId(req);

      const result = await this.updateClientSurveyUseCase.execute({
        clientId: id,
        gymId,
        ...req.body
      });

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async renew(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const gymId = getTenantId(req);
      const { monto } = req.body;

      // Calcular nueva fecha de vencimiento (30 días por defecto)
      const nuevaFechaVencimiento = new Date();
      nuevaFechaVencimiento.setDate(nuevaFechaVencimiento.getDate() + 30);

      const result = await this.renewClientUseCase.execute({
        clientId: id,
        gymId,
        monto,
        nuevaFechaVencimiento
      });

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async getExpiring(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);
      const days = parseInt(req.query.days as string) || 7;

      const clients = await this.clientRepository.getExpiringSoon(gymId, days);

      res.json({
        status: 'success',
        data: clients
      });
    } catch (error) {
      next(error);
    }
  }
}

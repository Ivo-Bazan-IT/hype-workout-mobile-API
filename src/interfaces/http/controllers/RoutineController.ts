import { Response, NextFunction } from 'express';
import { GenerateRoutineUseCase } from '../../../application/use-cases/routine/GenerateRoutineUseCase';
import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { IWhatsappProviderFactory } from '../../../domain/services/IWhatsappProviderFactory';
import { IFileStorage } from '../../../domain/services/IFileStorage';

export class RoutineController {
  constructor(
    private generateRoutineUseCase: GenerateRoutineUseCase,
    private routineRepository: IRoutineRepository,
    private gymRepository: IGymRepository,
    private gymSecretsRepo: IGymSecretsRepository,
    private clientRepository: IClientRepository,
    private whatsappProviderFactory: IWhatsappProviderFactory,
    private fileStorage: IFileStorage
  ) {}

  async generate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { clientId } = req.params;
      const user = req.user;

      if (!user?.gymId) {
        res.status(403).json({
          status: 'error',
          message: 'Gym access required'
        });
        return;
      }

      const result = await this.generateRoutineUseCase.execute(clientId, user.gymId);

      // 200 OK - procesamiento sincrónico
      res.status(200).json({
        status: 'success',
        message: 'Routine generated successfully',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = req.user;

      const routine = await this.routineRepository.findById(id, user?.gymId || '');
      if (!routine) {
        res.status(404).json({
          status: 'error',
          message: 'Routine not found'
        });
        return;
      }

      res.json({
        status: 'success',
        data: routine
      });
    } catch (error) {
      next(error);
    }
  }

  async getByClient(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { clientId } = req.params;
      const user = req.user;

      // Resolver gymId igual que el resto de controllers (admin+query o gymId del token)
      // y exigir su presencia: sin gymId no se puede aislar por tenant.
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

      const routines = await this.routineRepository.findByClientId(clientId, gymId);

      res.json({
        status: 'success',
        data: routines
      });
    } catch (error) {
      next(error);
    }
  }

  async getExpiring(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;
      const days = parseInt(req.query.days as string) || 7;

      if (!user?.gymId) {
        res.status(403).json({
          status: 'error',
          message: 'Gym access required'
        });
        return;
      }

      const count = await this.routineRepository.countExpiringByDay(user.gymId, days);

      res.json({
        status: 'success',
        data: {
          count,
          days
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async resend(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = req.user;

      const routine = await this.routineRepository.findById(id, user?.gymId || '');
      if (!routine) {
        res.status(404).json({
          status: 'error',
          message: 'Routine not found'
        });
        return;
      }

      // Reenviar WhatsApp sincrónicamente
      const gym = await this.gymRepository.findById(routine.gymId);
      const client = await this.clientRepository.findById(routine.clientId, routine.gymId);

      if (gym && client?.telefono && routine.pdfUrl) {
        const accessToken = await this.gymSecretsRepo.getWhatsappAccessToken(routine.gymId);
        if (!accessToken) {
          throw new Error('WhatsApp access token not configured');
        }

        const whatsappProvider = this.whatsappProviderFactory.create({
          phoneNumberId: gym.whatsappConfig.phoneNumberId,
          accessToken
        });

        const pdfBuffer = await this.fileStorage.read(routine.pdfUrl);
        const result = await whatsappProvider.sendPdfDocument({
          to: client.telefono,
          pdfBuffer,
          filename: `rutina-${client.nombre}.pdf`
        });

        await this.routineRepository.update(routine.id, routine.gymId, {
          whatsappMessageId: result.messageId
        });

        await this.routineRepository.updateStatus(routine.id, routine.gymId, 'generado', 'enviado');
      }

      res.json({
        status: 'success',
        message: 'Resend completed'
      });
    } catch (error) {
      next(error);
    }
  }
}
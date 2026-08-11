import { Request, Response, NextFunction } from 'express';
import { ProcessFormSubmissionUseCase } from '../../../application/use-cases/onboarding/ProcessFormSubmissionUseCase';
import { GetOnboardingStatusUseCase } from '../../../application/use-cases/onboarding/GetOnboardingStatusUseCase';
import { IFormsProvider } from '../../../domain/services/IFormsProvider';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';
import { UnauthorizedError } from '../../../shared/errors/AppError';

export class OnboardingController {
  constructor(
    private processFormUseCase: ProcessFormSubmissionUseCase,
    // El puerto, no `GoogleFormsWebhookHandler`: el borde HTTP no tiene por qué
    // saber que del otro lado hay un Google Form.
    private formsProvider: IFormsProvider,
    private getOnboardingStatusUseCase: GetOnboardingStatusUseCase
  ) {}

  async webhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const webhookSecret = req.headers['x-webhook-secret'];
      const { gymId, respuestas, responseId } = req.body;

      // Un solo mensaje para los tres rechazos posibles (no mandó secreto, el gym no
      // tiene secreto configurado, el secreto no coincide). Distinguirlos le
      // confirmaría a quien sondee qué gymId existen y cuáles ya están operativos.
      if (typeof webhookSecret !== 'string' || webhookSecret.length === 0) {
        throw new UnauthorizedError('Invalid webhook secret');
      }

      const esValido = await this.formsProvider.verificarSecret(gymId, webhookSecret);

      if (!esValido) {
        throw new UnauthorizedError('Invalid webhook secret');
      }

      const client = await this.processFormUseCase.execute({
        gymId,
        respuestas,
        responseId
      });

      res.status(201).json({
        status: 'success',
        data: {
          clientId: client.id,
          nombre: client.nombre,
          estado: client.estado
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async status(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const result = await this.getOnboardingStatusUseCase.execute({ gymId });

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

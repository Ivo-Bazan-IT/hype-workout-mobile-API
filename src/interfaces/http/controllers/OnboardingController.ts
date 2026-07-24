import { Request, Response, NextFunction } from 'express';
import { ProcessFormSubmissionUseCase } from '../../../application/use-cases/onboarding/ProcessFormSubmissionUseCase';
import { GoogleFormsWebhookHandler } from '../../../infrastructure/external/forms/GoogleFormsWebhookHandler';

export class OnboardingController {
  constructor(
    private processFormUseCase: ProcessFormSubmissionUseCase,
    private formsHandler: GoogleFormsWebhookHandler
  ) {}

  async webhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const webhookSecret = req.headers['x-webhook-secret'] as string;

      if (!webhookSecret) {
        res.status(401).json({
          status: 'error',
          message: 'Webhook secret required'
        });
        return;
      }

      const { gymId, respuestas } = req.body;

      // Validar webhook secret
      const { isValid } = await this.formsHandler.processSubmission(
        webhookSecret,
        { gymId, respuestas }
      );

      if (!isValid) {
        res.status(401).json({
          status: 'error',
          message: 'Invalid webhook secret'
        });
        return;
      }

      // Procesar submission
      const client = await this.processFormUseCase.execute({ gymId, respuestas });

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

  async status(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Este endpoint mostrará el estado de últimas submissions recibidas
      // Se podría implementar con Redis para tracking de submissions
      res.json({
        status: 'success',
        data: {
          lastSync: new Date().toISOString(),
          message: 'Webhook endpoint active'
        }
      });
    } catch (error) {
      next(error);
    }
  }
}
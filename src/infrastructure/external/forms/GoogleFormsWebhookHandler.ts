import { IFormsProvider, FormSubmission } from '../../../domain/services/IFormsProvider';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';

export class GoogleFormsWebhookHandler implements IFormsProvider {
  constructor(private gymRepository: IGymRepository) {}

  async processSubmission(webhookSecret: string, payload: FormSubmission): Promise<{
    isValid: boolean;
    gymId?: string;
    respuestas?: Record<string, any>;
  }> {
    // Obtener gym y validar webhookSecret
    const gym = await this.gymRepository.findById(payload.gymId);

    if (!gym) {
      return { isValid: false };
    }

    const expectedSecret = gym.googleFormConfig.webhookSecret;

    // Si el gym no tiene webhookSecret configurado, usar default
    const secretToValidate = expectedSecret || process.env.GOOGLE_FORMS_DEFAULT_WEBHOOK_SECRET;

    if (!secretToValidate || webhookSecret !== secretToValidate) {
      return { isValid: false };
    }

    return {
      isValid: true,
      gymId: payload.gymId,
      respuestas: payload.respuestas,
    };
  }

  async getWebhookSecret(gymId: string): Promise<string | null> {
    const gym = await this.gymRepository.findById(gymId);
    return gym?.googleFormConfig.webhookSecret || null;
  }
}
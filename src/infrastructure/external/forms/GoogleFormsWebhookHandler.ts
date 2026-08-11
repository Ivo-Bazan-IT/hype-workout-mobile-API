import { IFormsProvider } from '../../../domain/services/IFormsProvider';
import { IWebhookSecretService } from '../../../domain/services/IWebhookSecretService';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';

export class GoogleFormsWebhookHandler implements IFormsProvider {
  constructor(
    private gymRepository: IGymRepository,
    private webhookSecretService: IWebhookSecretService
  ) {}

  async verificarSecret(gymId: string, secret: string): Promise<boolean> {
    const gym = await this.gymRepository.findById(gymId);
    const hash = gym?.googleFormConfig?.webhookSecretHash;

    // Fail closed. Antes se caía a GOOGLE_FORMS_DEFAULT_WEBHOOK_SECRET, un secreto
    // de plataforma único para TODOS los tenants: como el `gymId` viaja en el body
    // de un endpoint público, con ese solo valor se podían dar de alta clientes en
    // cualquier gimnasio. Un gym sin secreto propio no recibe submissions hasta
    // rotarlo desde POST /api/gyms/settings/google-form/rotate-secret.
    if (!hash) {
      return false;
    }

    return this.webhookSecretService.verificar(secret, hash);
  }
}

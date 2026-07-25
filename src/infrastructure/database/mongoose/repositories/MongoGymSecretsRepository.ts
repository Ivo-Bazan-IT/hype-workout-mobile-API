import { GymModel } from '../schemas/GymSchema';
import { IGymSecretsRepository } from '../../../../domain/repositories/IGymRepository';
import { IEncryptionService } from '../../../../domain/services/IEncryptionService';
import { AiProvider } from '../../../../domain/entities/Gym';

/**
 * Secretos por-gym (BYOK) guardados cifrados con AES-256-GCM en la propia colección
 * de gyms, siguiendo el patrón que ya usaba `afipConfig.encryptedApiKey`.
 *
 * Reemplaza al `EnvGymSecretsRepository`, que ignoraba el `gymId` y devolvía la misma
 * credencial de entorno para todos los tenants: con eso, todos los gyms compartían la
 * cuota de IA y el PDF salía siempre del mismo número de WhatsApp.
 *
 * Regla de resolución, uniforme para las tres credenciales:
 *  1. Si el gym tiene su credencial cargada, se usa esa. Si no se puede descifrar,
 *     se LANZA: caer al env silenciosamente haría que el gym consuma la cuota de la
 *     plataforma (o mande el PDF desde otro número) sin que nadie se entere.
 *  2. Si el gym no cargó ninguna, se usa la del entorno como fallback de plataforma.
 */
export class MongoGymSecretsRepository implements IGymSecretsRepository {
  constructor(private encryptionService: IEncryptionService) {}

  async getWhatsappAccessToken(gymId: string): Promise<string | null> {
    const gym = await GymModel.findById(gymId);

    const encrypted = gym?.whatsappConfig?.encryptedAccessToken;
    if (encrypted) {
      return this.decryptOrThrow(encrypted, gymId, 'WhatsApp access token');
    }

    return process.env.WHATSAPP_DEFAULT_ACCESS_TOKEN || null;
  }

  async getAiApiKey(gymId: string, provider: AiProvider): Promise<string | null> {
    const gym = await GymModel.findById(gymId);

    const encrypted = gym?.aiConfig?.encryptedApiKey;
    if (encrypted) {
      return this.decryptOrThrow(encrypted, gymId, 'AI API key');
    }

    return this.platformAiApiKey(provider);
  }

  async getAfipApiKey(gymId: string): Promise<string | null> {
    const gym = await GymModel.findById(gymId);

    if (!gym || !gym.afipConfig?.isActive) {
      return process.env.AFIP_SDK_API_KEY || null;
    }

    const encrypted = gym.afipConfig.encryptedApiKey;
    if (encrypted) {
      return this.decryptOrThrow(encrypted, gymId, 'AFIP API key');
    }

    return process.env.AFIP_SDK_API_KEY || null;
  }

  private platformAiApiKey(provider: AiProvider): string | null {
    if (provider === 'deepseek') return process.env.DEEPSEEK_API_KEY || null;
    if (provider === 'openai') return process.env.OPENAI_API_KEY || null;
    if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || null;
    return null;
  }

  private decryptOrThrow(encrypted: string, gymId: string, label: string): string {
    try {
      return this.encryptionService.decrypt(encrypted);
    } catch (error) {
      console.error(`❌ Error decrypting ${label} for gym ${gymId}:`, error);
      throw new Error(
        `Stored ${label} for gym ${gymId} could not be decrypted. Re-enter it in the gym settings.`
      );
    }
  }
}

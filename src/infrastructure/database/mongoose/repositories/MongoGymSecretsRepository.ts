import { GymModel } from '../schemas/GymSchema';
import { IGymSecretsRepository } from '../../../../domain/repositories/IGymRepository';
import { IEncryptionService } from '../../../../domain/services/IEncryptionService';
import { AiProvider } from '../../../../domain/entities/Gym';
import {
  CredencialIAResuelta,
  PROVEEDOR_DE_RESPALDO,
  resolverCredencialIA,
} from '../../../../domain/ai/credentials';

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
 *
 * La credencial de IA agrega un tercer escalón (ver `resolveAiCredentials`), porque
 * es la única donde la plataforma puede atender al gym con OTRO proveedor.
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

  /**
   * Además de los dos escalones de arriba (key del gym → key de plataforma del
   * mismo proveedor), agrega un tercero: si tampoco hay key de plataforma para el
   * proveedor que el gym eligió, se degrada al de respaldo en vez de dejarlo sin
   * generar rutinas. La decisión de qué escalón corresponde vive en
   * `domain/ai/credentials`; acá solo se juntan las keys disponibles.
   */
  async resolveAiCredentials(
    gymId: string,
    preferido: AiProvider,
    modelPreferido?: string
  ): Promise<CredencialIAResuelta | null> {
    const gym = await GymModel.findById(gymId);

    // Si el gym cargó su key y no descifra, se sigue lanzando: degradar acá
    // haría que consuma la cuota de la plataforma teniendo la suya, que es
    // justamente lo que este repositorio vino a evitar.
    const encrypted = gym?.aiConfig?.encryptedApiKey;
    const keyDelGym = encrypted
      ? this.decryptOrThrow(encrypted, gymId, 'AI API key')
      : null;

    return resolverCredencialIA(preferido, modelPreferido, {
      gym: keyDelGym,
      plataforma: this.platformAiApiKey(preferido),
      respaldo: this.platformAiApiKey(PROVEEDOR_DE_RESPALDO),
    });
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

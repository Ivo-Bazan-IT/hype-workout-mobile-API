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

  /**
   * La cuenta de AFIP SDK es única y de la plataforma: no se consulta al gym.
   *
   * Antes esto priorizaba una key cifrada por gimnasio, y eso mezclaba dos cosas
   * distintas: la cuenta con el proveedor del SDK (que se paga y se cuotea una
   * sola vez) y la identidad fiscal del emisor (CUIT y punto de venta, que sí son
   * de cada gym y siguen viviendo en `afipConfig`). Con la key por gym, cualquier
   * dueño podía cargar una credencial suya —o pegar cualquier cosa— y romperse la
   * facturación solo, sin que la plataforma se enterara.
   */
  async getAfipApiKey(): Promise<string | null> {
    return process.env.AFIP_SDK_API_KEY || null;
  }

  /**
   * Las tres credenciales son independientes entre sí (se pueden cargar de a
   * una), pero para facturar hacen falta las tres juntas: sin cert o sin key no
   * hay con qué autenticarse contra AFIP aunque el access token sea válido. Por
   * eso esto devuelve `null` en vez de un objeto a medio completar — quien llama
   * no tiene que volver a chequear cuál de los tres faltó.
   */
  async getAfipCredentials(
    gymId: string
  ): Promise<{ accessToken: string; cert: string; key: string } | null> {
    const gym = await GymModel.findById(gymId);
    const afip = gym?.afipConfig;

    if (!afip?.encryptedApiKey || !afip.encryptedCert || !afip.encryptedKey) {
      return null;
    }

    return {
      accessToken: this.decryptOrThrow(afip.encryptedApiKey, gymId, 'AFIP SDK access token'),
      cert: this.decryptOrThrow(afip.encryptedCert, gymId, 'AFIP SDK certificate'),
      key: this.decryptOrThrow(afip.encryptedKey, gymId, 'AFIP SDK private key')
    };
  }

  /**
   * Igual criterio que `getAfipCredentials`: `null` si el gym nunca cargó su
   * access token de Mercado Pago (cuenta propia, sin OAuth desde el 22/08/2026).
   */
  async getMercadoPagoCredentials(gymId: string): Promise<{ accessToken: string } | null> {
    const gym = await GymModel.findById(gymId);
    const mp = gym?.mercadoPagoConfig;

    if (!mp?.encryptedAccessToken) {
      return null;
    }

    return {
      accessToken: this.decryptOrThrow(mp.encryptedAccessToken, gymId, 'Mercado Pago access token')
    };
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

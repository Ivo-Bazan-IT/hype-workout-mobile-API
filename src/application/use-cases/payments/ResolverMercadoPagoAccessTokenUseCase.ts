import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { IMercadoPagoOAuthService } from '../../../domain/services/IMercadoPagoOAuthService';
import { IEncryptionService } from '../../../domain/services/IEncryptionService';
import { ValidationError } from '../../../shared/errors/AppError';

/** Margen antes del vencimiento real para disparar el refresh. */
const MARGEN_REFRESH_MS = 10 * 60_000;

/**
 * Resuelve un access token de Mercado Pago VIGENTE para un gym, refrescándolo si
 * está por vencer (a diferencia del de AFIP SDK, el de MP vence a los 180 días).
 *
 * Compartido por `CreateRenewalPaymentLinkUseCase` (para pedir el link) y
 * `ProcessMercadoPagoWebhookUseCase` (para confirmar el pago): los dos necesitan
 * hablarle a la API de MP con la cuenta del gym correcto, y los dos tienen que
 * dejar el token refrescado guardado para el próximo que lo use.
 */
export class ResolverMercadoPagoAccessTokenUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private gymSecretsRepo: IGymSecretsRepository,
    private oauthService: IMercadoPagoOAuthService,
    private encryptionService: IEncryptionService
  ) {}

  async execute(gymId: string): Promise<string> {
    const credenciales = await this.gymSecretsRepo.getMercadoPagoCredentials(gymId);
    if (!credenciales) {
      throw new ValidationError('El gimnasio todavía no conectó su cuenta de Mercado Pago.');
    }

    const vigente =
      credenciales.expiraEn !== undefined &&
      credenciales.expiraEn.getTime() - Date.now() > MARGEN_REFRESH_MS;

    if (vigente) {
      return credenciales.accessToken;
    }

    const refrescado = await this.oauthService.refreshAccessToken(credenciales.refreshToken);
    const gym = await this.gymRepository.findById(gymId);

    await this.gymRepository.update(gymId, {
      mercadoPagoConfig: {
        ...gym?.mercadoPagoConfig,
        encryptedAccessToken: this.encryptionService.encrypt(refrescado.accessToken),
        encryptedRefreshToken: this.encryptionService.encrypt(refrescado.refreshToken),
        expiraEn: new Date(Date.now() + refrescado.expiresIn * 1000)
      }
    });

    return refrescado.accessToken;
  }
}

import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IMercadoPagoOAuthService } from '../../../domain/services/IMercadoPagoOAuthService';
import { IEncryptionService } from '../../../domain/services/IEncryptionService';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError } from '../../../shared/errors/AppError';

interface HandleCallbackDTO {
  gymId: string;
  code: string;
}

/**
 * Cierra el "Conectar con Mercado Pago": canjea el `code` que devolvió el
 * callback OAuth por el access/refresh token del gym y los guarda cifrados, mismo
 * criterio que `UpdateAfipCredentialsUseCase` con las credenciales de AFIP SDK.
 */
export class HandleMercadoPagoCallbackUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private oauthService: IMercadoPagoOAuthService,
    private encryptionService: IEncryptionService
  ) {}

  async execute(dto: HandleCallbackDTO): Promise<Gym> {
    const gym = await this.gymRepository.findById(dto.gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const tokens = await this.oauthService.exchangeCodeForToken(dto.code);

    const updated = await this.gymRepository.update(dto.gymId, {
      mercadoPagoConfig: {
        encryptedAccessToken: this.encryptionService.encrypt(tokens.accessToken),
        encryptedRefreshToken: this.encryptionService.encrypt(tokens.refreshToken),
        mpUserId: tokens.userId,
        expiraEn: new Date(Date.now() + tokens.expiresIn * 1000),
        conectadoEn: new Date()
      }
    });

    return updated!;
  }
}

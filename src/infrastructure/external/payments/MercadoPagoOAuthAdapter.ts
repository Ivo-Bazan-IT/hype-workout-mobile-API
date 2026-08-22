import axios from 'axios';
import { IMercadoPagoOAuthService } from '../../../domain/services/IMercadoPagoOAuthService';
import { ExternalServiceError } from '../../../shared/errors/AppError';

const MP_AUTH_BASE = 'https://auth.mercadopago.com';
const MP_API_BASE = 'https://api.mercadopago.com';
const TIMEOUT_MS = 15_000;

/**
 * OAuth de plataforma contra Mercado Pago: la app se registra UNA vez en Mercado
 * Pago Developers (`client_id`/`client_secret` propios), y cada gym autoriza esa
 * app a operar en su nombre — el mismo modelo que "Conectar con Google" o
 * "Conectar con Stripe".
 *
 * Contrato verificado contra la documentación pública de Mercado Pago (OAuth
 * Creation/Renewal): `GET https://auth.mercadopago.com/authorization` para el
 * paso de autorización, `POST https://api.mercadopago.com/oauth/token` para
 * canjear el `code` (u el `refresh_token`) por credenciales. La respuesta trae
 * `user_id`, que es la clave para identificar al gym desde el webhook de un pago.
 */
export class MercadoPagoOAuthAdapter implements IMercadoPagoOAuthService {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string
  ) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      platform_id: 'mp',
      redirect_uri: this.redirectUri,
      state
    });

    return `${MP_AUTH_BASE}/authorization?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    userId: string;
    expiresIn: number;
  }> {
    const data = await this.pedirToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: String(data.user_id),
      expiresIn: data.expires_in
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const data = await this.pedirToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  }

  private async pedirToken(extra: Record<string, string>): Promise<any> {
    try {
      const { data } = await axios.post(
        `${MP_API_BASE}/oauth/token`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          ...extra
        },
        { timeout: TIMEOUT_MS }
      );

      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const detalle = error?.response?.data?.message ?? error?.message ?? 'Error desconocido';
      throw new ExternalServiceError(
        `MERCADOPAGO_OAUTH_ERROR${status ? ` (${status})` : ''}: ${detalle}`
      );
    }
  }
}

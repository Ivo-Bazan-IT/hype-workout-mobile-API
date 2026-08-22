/**
 * OAuth de Mercado Pago, a nivel de PLATAFORMA (client_id/client_secret propios de
 * la app registrada en Mercado Pago Developers) — no confundir con
 * `IPaymentProviderFactory`, que arma el proveedor con el token YA obtenido de un
 * gym puntual.
 */
export interface IMercadoPagoOAuthService {
  /** URL a la que se redirige al dueño del gym para autorizar la conexión. */
  getAuthorizationUrl(state: string): string;

  /** Intercambia el `code` del callback por el par de tokens del gym. */
  exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    userId: string;
    expiresIn: number;
  }>;

  refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>;
}

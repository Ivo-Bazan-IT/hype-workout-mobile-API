import { IPaymentProviderFactory } from '../../../domain/services/IPaymentProviderFactory';
import { IPaymentProvider } from '../../../domain/services/IPaymentProvider';
import { MercadoPagoAdapter } from './MercadoPagoAdapter';

/**
 * Arma un adaptador por request con el access token del gym ya desencriptado.
 * Nunca cachea entre tenants — mismo motivo que `AfipSdkOwnAccountAdapterFactory`:
 * cachear uno dejaría a todos los gimnasios cobrando con la cuenta del primero.
 */
export class MercadoPagoAdapterFactory implements IPaymentProviderFactory {
  create(config: { accessToken: string }): IPaymentProvider {
    return new MercadoPagoAdapter(config.accessToken);
  }
}

import { IPaymentProvider } from './IPaymentProvider';

/**
 * Fábrica del proveedor de pagos: arma un adaptador por request con el access
 * token del gym ya desencriptado, mismo criterio que
 * `IOwnAccountInvoiceProviderFactory` — nunca cachea entre tenants, para que un
 * gym no termine cobrando con la cuenta de otro.
 */
export interface IPaymentProviderFactory {
  create(config: { accessToken: string }): IPaymentProvider;
}

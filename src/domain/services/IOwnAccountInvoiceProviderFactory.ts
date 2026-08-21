import { OwnAccountApiConfig } from '../billing/types';
import { IInvoiceProvider } from './IInvoiceProvider';

/**
 * Fábrica del proveedor de facturación en modo `cuenta_propia`: cada gym
 * factura contra su propia cuenta de AFIP SDK (CUIT, certificado, clave y
 * access token propios), a diferencia de `IInvoiceProviderFactory` (modo
 * `cuenta_unica`, desconectado), que solo variaba la identidad fiscal sobre
 * una cuenta compartida.
 */
export interface IOwnAccountInvoiceProviderFactory {
  create(config: OwnAccountApiConfig): IInvoiceProvider;
}

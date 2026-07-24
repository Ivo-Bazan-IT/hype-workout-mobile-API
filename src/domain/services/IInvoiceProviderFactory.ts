import { TenantApiConfig } from '../billing/types';
import { IInvoiceProvider } from './IInvoiceProvider';

/**
 * Fábrica de proveedores de facturación electrónica. Cada gym tiene su propia
 * configuración AFIP (cuit, punto de venta, condición fiscal, API key), así que el
 * caso de uso pide un IInvoiceProvider configurado para el tenant sin instanciar
 * el adaptador de AFIP directamente.
 */
export interface IInvoiceProviderFactory {
  create(config: TenantApiConfig): IInvoiceProvider;
}

import { GymInvoicePayload, AfipSdkInvoiceResponse } from '../billing/types';

/**
 * Proveedor de facturación electrónica ya configurado para un tenant.
 * La configuración por-gym (punto de venta, condición fiscal, API key) se inyecta
 * al crearlo vía IInvoiceProviderFactory; aquí solo se emite el comprobante.
 */
export interface IInvoiceProvider {
  emitInvoice(payload: GymInvoicePayload): Promise<AfipSdkInvoiceResponse>;
}

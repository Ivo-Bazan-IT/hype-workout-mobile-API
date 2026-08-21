import { IInvoiceProvider } from '../../../domain/services/IInvoiceProvider';
import { IInvoiceProviderFactory } from '../../../domain/services/IInvoiceProviderFactory';
import { TenantApiConfig } from '../../../domain/billing/types';
import { env } from '../../../config/env';
import { AfipSdkAdapter, AfipSdkEnvironment } from './AfipSdkAdapter';

/**
 * Único punto donde el entorno de despliegue entra a la facturación.
 *
 * El host, el entorno de ARCA y la credencial de la cuenta son configuración de
 * la plataforma, no reglas del comprobante. Lo que cambia por gimnasio —CUIT,
 * punto de venta, condición fiscal— viaja en `config`, y por eso se construye un
 * adaptador por factura: cachear uno dejaría a todos los tenants facturando con
 * el CUIT del primero.
 */
export class AfipSdkAdapterFactory implements IInvoiceProviderFactory {
  constructor(
    private readonly baseURL: string = env.AFIP_SDK_BASE_URL,
    private readonly environment: AfipSdkEnvironment = env.AFIP_SDK_ENVIRONMENT
  ) {}

  create(config: TenantApiConfig): IInvoiceProvider {
    return new AfipSdkAdapter(config, this.baseURL, this.environment);
  }
}

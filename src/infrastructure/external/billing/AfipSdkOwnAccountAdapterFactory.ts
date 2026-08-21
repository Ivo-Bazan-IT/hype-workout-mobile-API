import { IOwnAccountInvoiceProviderFactory } from '../../../domain/services/IOwnAccountInvoiceProviderFactory';
import { IInvoiceProvider } from '../../../domain/services/IInvoiceProvider';
import { OwnAccountApiConfig } from '../../../domain/billing/types';
import { env } from '../../../config/env';
import { AfipSdkOwnAccountAdapter, AfipSdkEnvironment } from './AfipSdkOwnAccountAdapter';

/**
 * Único punto donde el entorno de despliegue entra a la facturación en modo
 * `cuenta_propia`. El environment de ARCA (`dev`/`prod`) sigue siendo una
 * decisión de deploy, no del gym; lo que sí es del gym (CUIT, cert, key,
 * access token, punto de venta, condición fiscal) viaja en `config`, y por eso
 * se arma un adaptador por factura: cachear uno dejaría a todos los tenants
 * facturando con la cuenta del primero.
 */
export class AfipSdkOwnAccountAdapterFactory implements IOwnAccountInvoiceProviderFactory {
  constructor(private readonly environment: AfipSdkEnvironment = env.AFIP_SDK_ENVIRONMENT) {}

  create(config: OwnAccountApiConfig): IInvoiceProvider {
    return new AfipSdkOwnAccountAdapter(config, this.environment);
  }
}

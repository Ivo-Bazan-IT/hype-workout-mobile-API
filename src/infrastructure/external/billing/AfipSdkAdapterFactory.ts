import { IInvoiceProvider } from '../../../domain/services/IInvoiceProvider';
import { IInvoiceProviderFactory } from '../../../domain/services/IInvoiceProviderFactory';
import { TenantApiConfig } from '../../../domain/billing/types';
import { AfipSdkAdapter } from './AfipSdkAdapter';

export class AfipSdkAdapterFactory implements IInvoiceProviderFactory {
  create(config: TenantApiConfig): IInvoiceProvider {
    return new AfipSdkAdapter(config);
  }
}

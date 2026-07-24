import { IWhatsappProvider } from '../../../domain/services/IWhatsappProvider';
import { IWhatsappProviderFactory } from '../../../domain/services/IWhatsappProviderFactory';
import { MetaCloudApiProvider } from './MetaCloudApiProvider';

export class MetaCloudApiProviderFactory implements IWhatsappProviderFactory {
  create(config: { phoneNumberId: string; accessToken: string }): IWhatsappProvider {
    return new MetaCloudApiProvider(config.phoneNumberId, config.accessToken);
  }
}

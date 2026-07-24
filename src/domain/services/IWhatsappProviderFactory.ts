import { IWhatsappProvider } from './IWhatsappProvider';

/**
 * Fábrica de proveedores de WhatsApp. El caso de uso resuelve los secretos del gym
 * (phoneNumberId + accessToken) y pide un IWhatsappProvider ya configurado, sin
 * instanciar el adaptador de Meta ni acoplarse al vendor.
 */
export interface IWhatsappProviderFactory {
  create(config: { phoneNumberId: string; accessToken: string }): IWhatsappProvider;
}

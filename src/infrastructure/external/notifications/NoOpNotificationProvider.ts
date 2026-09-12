import { INotificationProvider } from '../../../domain/services/INotificationProvider';

export class NoOpNotificationProvider implements INotificationProvider {
  async notificarSeguimiento(clientId: string, gymId: string, mensaje: string): Promise<void> {
    console.log(`[NoOpNotificationProvider] gym=${gymId} client=${clientId} mensaje=${mensaje}`);
  }
}

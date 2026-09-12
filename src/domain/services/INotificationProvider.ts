export interface INotificationProvider {
  notificarSeguimiento(clientId: string, gymId: string, mensaje: string): Promise<void>;
}

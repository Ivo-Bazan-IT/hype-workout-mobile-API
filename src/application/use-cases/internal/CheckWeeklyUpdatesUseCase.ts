import { INotificationProvider } from '../../../domain/services/INotificationProvider';
import { IProgressUpdateRepository } from '../../../domain/repositories/IProgressUpdateRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';

export class CheckWeeklyUpdatesUseCase {
  constructor(
    private progressRepo: IProgressUpdateRepository,
    private clientRepo: IClientRepository,
    private notificationProvider: INotificationProvider
  ) {}

  async execute(gymId: string): Promise<{ notificados: number }> {
    const pendientes = await this.progressRepo.searchPendientesByGym(gymId);
    const ahora = new Date();
    const umbralFalsoPositivoMs = 3 * 24 * 60 * 60 * 1000; // 3 días
    let notificados = 0;
    for (const p of pendientes) {
      const client = await this.clientRepo.findById(p.clientId, gymId);
      if (!client) continue;
      // Evita falsos positivos para clientes recién asignados:
      // si el RoutineProgressUpdate fue creado hace menos de 3 días, se omite.
      // El mecanismo definitivo de notificación (pop-up / mobile) es del front;
      // este caso de uso mantiene el puerto INotificationProvider para integrarlo luego.
      const creado = new Date(p.createdAt);
      if (ahora.getTime() - creado.getTime() < umbralFalsoPositivoMs) continue;
      await this.notificationProvider.notificarSeguimiento(
        p.clientId,
        gymId,
        `Seguimiento pendiente de la semana ${p.semana}`
      );
      notificados++;
    }
    return { notificados };
  }
}

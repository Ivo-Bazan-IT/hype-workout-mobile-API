import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { IWhatsappProviderFactory } from '../../../domain/services/IWhatsappProviderFactory';
import { IFileStorage } from '../../../domain/services/IFileStorage';
import {
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors/AppError';

/**
 * Reenvía por WhatsApp el PDF de una rutina ya generada.
 *
 * Es la contraparte del envío best-effort de `GenerateRoutineUseCase`: cuando una
 * generación termina en `estadoEnvio: 'error'` o `'pendiente'`, la rutina y su PDF
 * existen y solo falta hacerlos llegar. Reintentar acá es gratis; regenerar
 * costaría otra llamada al modelo.
 *
 * Cada condición que impide enviar se rechaza con un error propio y accionable. La
 * versión anterior vivía en el controller y respondía `"Resend completed"` aunque no
 * hubiera enviado nada: el dueño apretaba reenviar, veía un éxito, y el socio nunca
 * recibía la rutina.
 */
export class ResendRoutineUseCase {
  constructor(
    private routineRepository: IRoutineRepository,
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository,
    private gymSecretsRepo: IGymSecretsRepository,
    private whatsappProviderFactory: IWhatsappProviderFactory,
    private fileStorage: IFileStorage
  ) {}

  async execute(routineId: string, gymId: string): Promise<{ whatsappMessageId: string }> {
    const routine = await this.routineRepository.findById(routineId, gymId);
    if (!routine) {
      throw new NotFoundError('Routine');
    }

    if (!routine.pdfUrl) {
      // Sin PDF no hay nada que reenviar: la generación falló antes de producirlo
      // y lo que corresponde es volver a generarla, no reintentar el envío.
      throw new ValidationError(
        'This routine has no PDF yet. Generate it again before resending.'
      );
    }

    const client = await this.clientRepository.findById(routine.clientId, gymId);
    if (!client) {
      throw new NotFoundError('Client');
    }

    if (!client.telefono) {
      throw new ValidationError(
        'The client has no phone number. Add it before resending the routine.'
      );
    }

    const gym = await this.gymRepository.findById(gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }

    const phoneNumberId = gym.whatsappConfig?.phoneNumberId;
    if (!phoneNumberId) {
      throw new ValidationError(
        'The gym has no WhatsApp phone number configured. Set it in the gym settings.'
      );
    }

    const accessToken = await this.gymSecretsRepo.getWhatsappAccessToken(gymId);
    if (!accessToken) {
      throw new ValidationError(
        'The gym has no WhatsApp access token configured. Set it in the gym settings.'
      );
    }

    const pdfBuffer = await this.fileStorage.read(routine.pdfUrl);

    // 'enviando' antes de salir: si el proceso se cae en el medio, el estado no
    // queda diciendo que la entrega sigue pendiente cuando ya se intentó.
    await this.routineRepository.updateStatus(routineId, gymId, 'generado', 'enviando');

    try {
      const whatsappProvider = this.whatsappProviderFactory.create({
        phoneNumberId,
        accessToken,
      });

      const result = await whatsappProvider.sendPdfDocument({
        to: client.telefono,
        pdfBuffer,
        filename: `rutina-${client.nombre}.pdf`,
      });

      await this.routineRepository.update(routineId, gymId, {
        whatsappMessageId: result.messageId,
      });
      await this.routineRepository.updateStatus(routineId, gymId, 'generado', 'enviado');

      return { whatsappMessageId: result.messageId };
    } catch (error) {
      // Vuelve a 'error', no a 'enviando': la rutina queda reintentable y no colgada
      await this.routineRepository.updateStatus(routineId, gymId, 'generado', 'error');

      console.error(`❌ Falló el reenvío de la rutina ${routineId}:`, error);
      throw new ExternalServiceError(
        `WhatsApp rejected the message: ${(error as Error)?.message ?? 'unknown error'}`
      );
    }
  }
}

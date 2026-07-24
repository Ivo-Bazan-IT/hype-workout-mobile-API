import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { IAIProviderFactory } from '../../../domain/services/IAIProviderFactory';
import { IPdfGenerator } from '../../../domain/services/IPdfGenerator';
import { IWhatsappProviderFactory } from '../../../domain/services/IWhatsappProviderFactory';
import { IFileStorage } from '../../../domain/services/IFileStorage';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

export class GenerateRoutineUseCase {
  constructor(
    private routineRepository: IRoutineRepository,
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository,
    private gymSecretsRepo: IGymSecretsRepository,
    private aiProviderFactory: IAIProviderFactory,
    private pdfGenerator: IPdfGenerator,
    private whatsappProviderFactory: IWhatsappProviderFactory,
    private fileStorage: IFileStorage
  ) {}

  async execute(clientId: string, gymId: string): Promise<{ routineId: string }> {
    // Verificar cliente existe y pertenece al gym
    const client = await this.clientRepository.findById(clientId, gymId);
    if (!client) {
      throw new NotFoundError('Client');
    }

    // Verificar gym existe
    const gym = await this.gymRepository.findById(gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }

    // Verificar que el cliente tiene encuestaData
    if (!client.encuestaData) {
      throw new ValidationError('Client has no survey data. Complete the onboarding form first.');
    }

    // Crear rutina en estado pendiente
    const routine = await this.routineRepository.create({
      gymId: client.gymId,
      clientId: client.id,
      fechaVencimiento: client.fechaVencimiento,
    });

    // Generar rutina sincrónicamente
    try {
      await this.routineRepository.updateStatus(routine.id, gymId, 'generando');

      // 1. Obtener API key de IA
      const aiApiKey = await this.gymSecretsRepo.getAiApiKey(gymId, gym.aiConfig.provider);
      if (!aiApiKey) {
        throw new Error(`AI API key not configured for gym ${gymId}`);
      }

      // 2. Generar rutina con IA (proveedor por-gym vía factory)
      const aiProvider = this.aiProviderFactory.create(gym.aiConfig.provider, aiApiKey);
      const iaResult = await aiProvider.generateRoutine({
        promptTemplate: gym.aiConfig.promptTemplate,
        encuestaData: client.encuestaData || {}
      });

      // 3. Guardar contenido generado
      await this.routineRepository.update(routine.id, gymId, {
        contenidoGenerado: iaResult.contenidoGenerado,
        promptUsado: gym.aiConfig.promptTemplate,
        fechaGeneracion: new Date()
      });

      // 4. Generar PDF y persistirlo vía el puerto de almacenamiento
      const pdfBuffer = await this.pdfGenerator.generateFromHtml({
        template: {
          htmlTemplate: `<html><body><h1>Rutina para {{clienteNombre}}</h1><div>{{rutina}}</div></body></html>`,
          cssStyles: ''
        },
        data: {
          clienteNombre: client.nombre,
          fechaVencimiento: client.fechaVencimiento.toISOString(),
          rutina: iaResult.contenidoGenerado
        }
      });

      const { url: pdfUrl } = await this.fileStorage.save({
        content: pdfBuffer,
        filename: `${routine.id}.pdf`
      });

      // Actualizar rutina con la URL del PDF
      await this.routineRepository.update(routine.id, gymId, { pdfUrl });

      // 5. Enviar WhatsApp (si está configurado) reutilizando el buffer ya generado
      const accessToken = await this.gymSecretsRepo.getWhatsappAccessToken(gymId);
      if (accessToken && client.telefono) {
        const whatsappProvider = this.whatsappProviderFactory.create({
          phoneNumberId: gym.whatsappConfig.phoneNumberId,
          accessToken
        });

        const result = await whatsappProvider.sendPdfDocument({
          to: client.telefono,
          pdfBuffer,
          filename: `rutina-${client.nombre}.pdf`
        });

        await this.routineRepository.update(routine.id, gymId, {
          whatsappMessageId: result.messageId
        });
      }

      // Marcar como completado
      await this.routineRepository.updateStatus(routine.id, gymId, 'generado', 'enviado');
    } catch (error) {
      console.error('❌ Routine generation error:', error);
      await this.routineRepository.updateStatus(routine.id, gymId, 'error');
      throw error;
    }

    return { routineId: routine.id };
  }
}

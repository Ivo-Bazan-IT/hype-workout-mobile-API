import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { IAIProviderFactory } from '../../../domain/services/IAIProviderFactory';
import { IPdfGenerator } from '../../../domain/services/IPdfGenerator';
import { IWhatsappProviderFactory } from '../../../domain/services/IWhatsappProviderFactory';
import { IFileStorage } from '../../../domain/services/IFileStorage';
import { IAiUsageRepository } from '../../../domain/repositories/IAiUsageRepository';
import { AiUsage } from '../../../domain/services/IAIProvider';
import { renderPromptTemplate } from '../../../domain/prompt/promptTemplate';
import { calcularCostoEstimado } from '../../../domain/ai/pricing';
import { Client } from '../../../domain/entities/Client';
import { Gym } from '../../../domain/entities/Gym';
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
    private fileStorage: IFileStorage,
    private aiUsageRepository: IAiUsageRepository
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

    // Verificar que el cliente tiene encuestaData. Un objeto vacío también es
    // inválido: sin respuestas no hay nada que personalizar.
    if (!client.encuestaData || Object.keys(client.encuestaData).length === 0) {
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

      // 1. Obtener API key de IA (la propia del gym; ver MongoGymSecretsRepository)
      const aiApiKey = await this.gymSecretsRepo.getAiApiKey(gymId, gym.aiConfig.provider);
      if (!aiApiKey) {
        // ValidationError y no Error genérico: es una configuración que le falta al
        // gym, y merece un 400 accionable en vez de un 500 "Internal server error".
        throw new ValidationError(
          `No AI API key configured for provider "${gym.aiConfig.provider}". Add it in the gym settings.`
        );
      }

      // 2. Renderizar el prompt del gym con los datos del cliente. El template lo
      //    edita el dueño (PUT /api/gyms/settings/ai-prompt) para describir su
      //    equipamiento, espacios y restricciones.
      const prompt = renderPromptTemplate(gym.aiConfig.promptTemplate, {
        encuestaData: client.encuestaData,
        clienteNombre: client.nombre,
        clienteDocumento: client.documento,
        clienteEmail: client.email,
        clienteTelefono: client.telefono,
        clienteFechaInicio: client.fechaInicio,
        clienteFechaVencimiento: client.fechaVencimiento,
        gymNombre: gym.name
      });

      // 3. Generar rutina con IA (proveedor y modelo por-gym vía factory)
      const aiProvider = this.aiProviderFactory.create(gym.aiConfig.provider, aiApiKey);
      const iaResult = await aiProvider.generateRoutine({
        prompt,
        model: gym.aiConfig.model
      });

      // 4. Guardar contenido generado. Se persiste el prompt YA renderizado: es lo
      //    que realmente recibió el modelo, y sirve para auditar una rutina dudosa.
      await this.routineRepository.update(routine.id, gymId, {
        contenidoGenerado: iaResult.contenidoGenerado,
        promptUsado: prompt,
        fechaGeneracion: new Date()
      });

      // 4b. Registrar el consumo de IA de este gym. Va acá, apenas responde el
      //     modelo: si se registrara al final, un fallo del PDF o de WhatsApp
      //     perdería un gasto que el proveedor ya cobró.
      await this.registrarConsumo(routine.id, client, gym, iaResult.usage);

      // 5. Generar PDF y persistirlo vía el puerto de almacenamiento
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

      // 6. Enviar WhatsApp reutilizando el buffer ya generado. Requiere las tres
      //    cosas: el número del gym, su token y el teléfono del cliente.
      const accessToken = await this.gymSecretsRepo.getWhatsappAccessToken(gymId);
      const phoneNumberId = gym.whatsappConfig?.phoneNumberId;
      const puedeEnviar = Boolean(accessToken && phoneNumberId && client.telefono);

      if (puedeEnviar) {
        const whatsappProvider = this.whatsappProviderFactory.create({
          phoneNumberId: phoneNumberId!,
          accessToken: accessToken!
        });

        const result = await whatsappProvider.sendPdfDocument({
          to: client.telefono!,
          pdfBuffer,
          filename: `rutina-${client.nombre}.pdf`
        });

        await this.routineRepository.update(routine.id, gymId, {
          whatsappMessageId: result.messageId
        });
      }

      // El estado de envío refleja lo que realmente pasó: marcar 'enviado' cuando el
      // envío se salteó dejaba rutinas que nadie recibió figurando como entregadas,
      // y no había forma de detectarlas para reenviarlas.
      await this.routineRepository.updateStatus(
        routine.id,
        gymId,
        'generado',
        puedeEnviar ? 'enviado' : 'pendiente'
      );
    } catch (error) {
      console.error('❌ Routine generation error:', error);
      await this.routineRepository.updateStatus(routine.id, gymId, 'error');
      throw error;
    }

    return { routineId: routine.id };
  }

  /**
   * Persiste el consumo atribuido al gym.
   *
   * No es fatal: la rutina ya fue generada y el proveedor ya cobró, así que un
   * fallo al guardar la medición se registra en el log pero no tira abajo una
   * generación exitosa ni marca la rutina en error.
   */
  private async registrarConsumo(
    routineId: string,
    client: Client,
    gym: Gym,
    usage?: AiUsage
  ): Promise<void> {
    if (!usage) {
      console.warn(
        `⚠️  El proveedor ${gym.aiConfig.provider} no informó consumo para la rutina ${routineId}: queda sin medir.`
      );
      return;
    }

    try {
      await this.aiUsageRepository.create({
        gymId: client.gymId,
        clientId: client.id,
        routineId,
        provider: gym.aiConfig.provider,
        model: usage.model,
        tokensPrompt: usage.tokensPrompt,
        tokensRespuesta: usage.tokensRespuesta,
        tokensTotal: usage.tokensTotal,
        costoEstimado: calcularCostoEstimado(
          usage.model,
          usage.tokensPrompt,
          usage.tokensRespuesta
        )
      });
    } catch (error) {
      console.error(`❌ No se pudo registrar el consumo de la rutina ${routineId}:`, error);
    }
  }
}

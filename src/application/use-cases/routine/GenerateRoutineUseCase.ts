import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { IAIProviderFactory } from '../../../domain/services/IAIProviderFactory';
import { IPdfGenerator } from '../../../domain/services/IPdfGenerator';
import { IWhatsappProviderFactory } from '../../../domain/services/IWhatsappProviderFactory';
import { IFileStorage } from '../../../domain/services/IFileStorage';
import { IPlantillaRutinaProvider } from '../../../domain/services/IPlantillaRutinaProvider';
import { resolverPlantillaPdf } from '../../../domain/pdf/routineTemplate';
import { IAiUsageRepository } from '../../../domain/repositories/IAiUsageRepository';
import { AiUsage } from '../../../domain/services/IAIProvider';
import { renderPromptTemplate } from '../../../domain/prompt/promptTemplate';
import { resolverPromptTemplate } from '../../../domain/prompt/promptStandard';
import { calcularCostoEstimado } from '../../../domain/ai/pricing';
import { CredencialIAResuelta, FuenteCredencialIA } from '../../../domain/ai/credentials';
import { Client } from '../../../domain/entities/Client';
import { Gym } from '../../../domain/entities/Gym';
import { RoutineSendStatus } from '../../../domain/entities/Routine';
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
    private aiUsageRepository: IAiUsageRepository,
    private plantillaProvider: IPlantillaRutinaProvider
  ) {}

  async execute(
    clientId: string,
    gymId: string
  ): Promise<{
    routineId: string;
    fuenteCredencial: FuenteCredencialIA;
    estadoEnvio: RoutineSendStatus;
  }> {
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

      // 1. Resolver la credencial de IA: la propia del gym, la de plataforma para
      //    su proveedor, o el proveedor de respaldo. Ver domain/ai/credentials.
      const credencial = await this.gymSecretsRepo.resolveAiCredentials(
        gymId,
        gym.aiConfig.provider,
        gym.aiConfig.model
      );
      if (!credencial) {
        // ValidationError y no Error genérico: es una configuración que le falta al
        // gym, y merece un 400 accionable en vez de un 500 "Internal server error".
        throw new ValidationError(
          `No AI API key configured for provider "${gym.aiConfig.provider}". Add it in the gym settings.`
        );
      }

      if (credencial.fuente === 'respaldo') {
        // Warning y no silencio: la rutina se generó con un modelo que el dueño no
        // eligió y cuyo consumo paga la plataforma. Que funcione no lo vuelve normal.
        console.warn(
          `⚠️  El gym ${gymId} no tiene API key para "${gym.aiConfig.provider}" ni la plataforma tampoco: ` +
            `la rutina ${routine.id} se genera con el proveedor de respaldo "${credencial.provider}".`
        );
      }

      // 2. Renderizar el prompt de CONTENIDO con los datos del cliente. Es el del
      //    gym si escribió uno (PUT /api/gyms/settings/ai-prompt, donde describe su
      //    equipamiento, espacios y restricciones) y el standard de la plataforma si
      //    no. El FORMATO del JSON no sale de acá: lo fija la instrucción de sistema
      //    en los adaptadores, para que el contrato con el PDF no dependa de lo que
      //    cada gym haya escrito.
      const { template: promptDeContenido } = resolverPromptTemplate(
        gym.aiConfig.promptTemplate
      );

      const prompt = renderPromptTemplate(promptDeContenido, {
        encuestaData: client.encuestaData,
        clienteNombre: client.nombre,
        clienteDocumento: client.documento,
        clienteEmail: client.email,
        clienteTelefono: client.telefono,
        clienteFechaInicio: client.fechaInicio,
        clienteFechaVencimiento: client.fechaVencimiento,
        gymNombre: gym.name,
        // El mismo mapeo con el que el webhook leyó la submission. Es lo que permite
        // que `{{cliente_objetivo}}` encuentre la respuesta aunque el gym haya
        // titulado la pregunta "Objetivos con el entrenamiento".
        fieldMapping: gym.googleFormConfig?.fieldMapping
      });

      // 3. Generar rutina con IA (proveedor y modelo ya resueltos vía factory)
      const aiProvider = this.aiProviderFactory.create(credencial.provider, credencial.apiKey);
      const iaResult = await aiProvider.generateRoutine({
        prompt,
        model: credencial.model
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
      await this.registrarConsumo(routine.id, client, credencial, iaResult.usage);

      // 5. Generar PDF y persistirlo vía el puerto de almacenamiento.
      //    La plantilla es la propia del gym si cargó una, y si no la standard de
      //    la plataforma; el HTML se estampa sobre el PDF de fondo.
      const plantilla = resolverPlantillaPdf(
        gym.pdfTemplate,
        await this.plantillaProvider.obtenerStandard()
      );

      const pdfBuffer = await this.pdfGenerator.generateFromHtml({
        template: {
          htmlTemplate: plantilla.htmlTemplate,
          cssStyles: plantilla.cssStyles
        },
        data: {
          clienteNombre: client.nombre,
          gymNombre: gym.name,
          fechaGeneracion: this.formatearFecha(new Date()),
          fechaVencimiento: this.formatearFecha(client.fechaVencimiento),
          rutina: iaResult.contenidoGenerado
        },
        fondo: plantilla.fondo
      });

      const { url: pdfUrl } = await this.fileStorage.save({
        content: pdfBuffer,
        filename: `${routine.id}.pdf`
      });

      // Actualizar rutina con la URL del PDF
      await this.routineRepository.update(routine.id, gymId, { pdfUrl });

      // 6. Enviar por WhatsApp, reutilizando el buffer ya generado.
      const estadoEnvio = await this.intentarEnvio(routine.id, gymId, gym, client, pdfBuffer);

      // El estado de envío refleja lo que realmente pasó: marcar 'enviado' cuando el
      // envío se salteó o falló dejaba rutinas que nadie recibió figurando como
      // entregadas, y no había forma de detectarlas para reenviarlas.
      await this.routineRepository.updateStatus(routine.id, gymId, 'generado', estadoEnvio);

      // Se devuelven la fuente y el estado de envío para que el llamador sepa qué
      // pasó realmente sin tener que volver a pedir la rutina: si salió por el
      // proveedor de respaldo, y si el socio efectivamente la recibió.
      return {
        routineId: routine.id,
        fuenteCredencial: credencial.fuente,
        estadoEnvio
      };
    } catch (error) {
      console.error('❌ Routine generation error:', error);
      await this.routineRepository.updateStatus(routine.id, gymId, 'error');
      throw error;
    }
  }

  /**
   * Envía el PDF por WhatsApp y devuelve el estado resultante. **Nunca lanza.**
   *
   * Es best-effort a propósito: para cuando se llega acá la rutina ya se generó, el
   * modelo ya se cobró y el PDF ya está guardado. Tirar abajo todo eso porque Meta
   * devolvió un error perdería trabajo bueno y obligaría al gym a pagar otra
   * generación para recuperarlo.
   *
   * La diferencia entre los dos estados de "no llegó" importa:
   *  - `pendiente` → no se pudo ni intentar (falta el número del gym, su token o el
   *    teléfono del socio). Se resuelve completando la configuración.
   *  - `error`     → se intentó y falló. Se resuelve reintentando con
   *    `POST /api/routines/:id/resend`.
   */
  private async intentarEnvio(
    routineId: string,
    gymId: string,
    gym: Gym,
    client: Client,
    pdfBuffer: Buffer
  ): Promise<RoutineSendStatus> {
    try {
      // La resolución del token va adentro del try: si el gym cargó uno y no se
      // puede descifrar, `getWhatsappAccessToken` lanza — y eso no debe costar la
      // rutina entera.
      const accessToken = await this.gymSecretsRepo.getWhatsappAccessToken(gymId);
      const phoneNumberId = gym.whatsappConfig?.phoneNumberId;

      if (!accessToken || !phoneNumberId || !client.telefono) {
        return 'pendiente';
      }

      const whatsappProvider = this.whatsappProviderFactory.create({
        phoneNumberId,
        accessToken
      });

      const result = await whatsappProvider.sendPdfDocument({
        to: client.telefono,
        pdfBuffer,
        filename: `rutina-${client.nombre}.pdf`
      });

      await this.routineRepository.update(routineId, gymId, {
        whatsappMessageId: result.messageId
      });

      return 'enviado';
    } catch (error) {
      console.error(`❌ No se pudo enviar la rutina ${routineId} por WhatsApp:`, error);
      return 'error';
    }
  }

  /**
   * Fecha para el PDF, en formato es-AR: lo lee un socio argentino, no una máquina.
   * El ISO se reserva para los campos que consume el front.
   */
  private formatearFecha(fecha: Date): string {
    return fecha.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
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
    credencial: CredencialIAResuelta,
    usage?: AiUsage
  ): Promise<void> {
    if (!usage) {
      console.warn(
        `⚠️  El proveedor ${credencial.provider} no informó consumo para la rutina ${routineId}: queda sin medir.`
      );
      return;
    }

    try {
      await this.aiUsageRepository.create({
        gymId: client.gymId,
        clientId: client.id,
        routineId,
        // El proveedor REALMENTE usado, no el configurado: si la generación
        // degradó al respaldo, atribuirle los tokens al proveedor que el gym
        // eligió cargaría consumo a una cuenta que nunca se llamó.
        provider: credencial.provider,
        model: usage.model,
        tokensPrompt: usage.tokensPrompt,
        tokensRespuesta: usage.tokensRespuesta,
        tokensTotal: usage.tokensTotal,
        fuenteCredencial: credencial.fuente,
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

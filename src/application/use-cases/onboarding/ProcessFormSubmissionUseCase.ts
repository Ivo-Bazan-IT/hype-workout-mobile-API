import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IFormSubmissionRecordRepository } from '../../../domain/repositories/IFormSubmissionRecordRepository';
import { FormSubmission } from '../../../domain/services/IFormsProvider';
import { Client, tieneEncuestaCompleta } from '../../../domain/entities/Client';
import { extraerCampoDelCliente } from '../../../domain/forms/fieldMapping';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

/**
 * Vuelca las respuestas del formulario de ingreso sobre el socio que ya existe.
 *
 * **No crea clientes.** El onboarding de este CRM es secuencial —se da de alta al
 * socio, paga, y recién ahí contesta la encuesta—, así que un documento que no
 * está en la base no es un socio nuevo: es un DNI mal tipeado. Crearlo igual dejaba
 * una ficha fantasma con datos a medias que después había que detectar y fusionar a
 * mano, y de paso ensuciaba el embudo con un alta que nadie hizo. Ahora eso es un
 * 404 que el Apps Script sabe explicar.
 *
 * El documento es la única clave natural del socio dentro del gym, y por eso es la
 * que une el formulario con la ficha.
 *
 * **Idempotente por `responseId`.** El Apps Script reintenta ante 5xx y timeouts, así
 * que una respuesta cuya confirmación se perdió vuelve a llegar. Toda submission
 * queda asentada —procesada o rechazada— y eso alimenta también
 * `GET /api/onboarding/status`.
 */
export class ProcessFormSubmissionUseCase {
  constructor(
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository,
    private submissionRecordRepository: IFormSubmissionRecordRepository
  ) {}

  async execute(payload: FormSubmission): Promise<Client> {
    // Verificar que el gym existe y está activo. Errores del dominio, no `Error`
    // pelado: este último caía en el 500 del errorHandler y el webhook informaba
    // "Internal server error" ante un gym dado de baja, que es entrada inválida.
    const gym = await this.gymRepository.findById(payload.gymId);
    if (!gym) {
      throw new NotFoundError('Gym');
    }
    if (!gym.isActive) {
      throw new ValidationError('Gym is inactive');
    }

    // Cortocircuito de idempotencia. Se chequea DESPUÉS de validar el gym para que
    // un gym dado de baja siga dando el mismo error que la primera vez, y solo
    // contra submissions que terminaron bien: una rechazada tiene que poder
    // reprocesarse, porque reenviarla es justamente cómo se recupera un DNI que no
    // existía y ya fue dado de alta.
    const yaRecibida = payload.responseId
      ? await this.submissionRecordRepository.findByResponseId(
          payload.gymId,
          payload.responseId
        )
      : null;

    if (yaRecibida?.resultado === 'procesada' && yaRecibida.clientId) {
      const yaCargado = await this.clientRepository.findById(
        yaRecibida.clientId,
        payload.gymId
      );

      // Si el socio se borró desde entonces, se sigue de largo y se reprocesa: el
      // registro viejo apunta a una ficha que ya no está.
      if (yaCargado) {
        return yaCargado;
      }
    }

    const respuestas = payload.respuestas;

    // Cada gym titula las preguntas de su Form como quiere. Si declaró el mapeo, se
    // usa el suyo; si no, se cae a la heurística por alias. La regla de resolución
    // vive en `domain/forms/fieldMapping`, no acá: es negocio, no orquestación.
    const mapping = gym.googleFormConfig?.fieldMapping;

    const nombre = extraerCampoDelCliente(respuestas, 'nombre', mapping);
    const documento = extraerCampoDelCliente(respuestas, 'documento', mapping);
    const telefono = extraerCampoDelCliente(respuestas, 'telefono', mapping);
    const email = extraerCampoDelCliente(respuestas, 'email', mapping) || undefined;

    // El documento es lo único sin lo cual no se puede hacer nada: es la clave que
    // une la respuesta con la ficha. Nombre y teléfono son datos que la submission
    // refresca, y exigirlos rechazaría un formulario que solo pregunta la encuesta.
    if (!documento) {
      await this.rechazar(payload, undefined, 'Missing documento in form submission');
      throw new ValidationError('Missing required field in form submission: documento');
    }

    const existingClient = await this.clientRepository.findByDocumento(
      documento,
      payload.gymId
    );

    if (!existingClient) {
      // Se nombra el documento en el mensaje a propósito: quien administra el gym
      // necesita saber QUÉ DNI no matcheó para corregirlo o dar de alta al socio.
      // No filtra nada — del otro lado hay un formulario que ya probó el secreto.
      const motivo = `Client with documento ${documento} not found`;
      await this.rechazar(payload, documento, motivo);
      throw new NotFoundError(`Client with documento ${documento}`);
    }

    // Unificar, no reemplazar: las respuestas nuevas se fusionan sobre las previas
    // para que un reenvío parcial del formulario no borre lo ya contestado.
    const encuestaData = {
      ...(existingClient.encuestaData || {}),
      ...respuestas
    };

    // Un socio cargado a mano y sin encuesta era un lead: esta submission es su
    // conversión. Un reenvío del mismo formulario ya lo encuentra convertido y no
    // le corre la fecha.
    const conviertioAhora =
      !tieneEncuestaCompleta(existingClient.encuestaData) &&
      existingClient.fechaConversion === undefined &&
      tieneEncuestaCompleta(encuestaData);

    // Los datos de contacto se refrescan con lo último que envió el socio, pero solo
    // si vinieron: un formulario que no pregunta el teléfono no tiene por qué borrar
    // el que ya estaba cargado.
    const clienteActualizado = await this.clientRepository.update(
      existingClient.id,
      payload.gymId,
      {
        ...(nombre !== null && { nombre }),
        ...(telefono !== null && { telefono }),
        ...(email !== undefined && { email }),
        ...(conviertioAhora && { fechaConversion: new Date() }),
        encuestaData
      }
    );

    if (!clienteActualizado) {
      throw new NotFoundError('Client');
    }

    await this.submissionRecordRepository.registrar({
      gymId: payload.gymId,
      responseId: payload.responseId,
      documento,
      clientId: clienteActualizado.id,
      resultado: 'procesada',
      recibidaEn: new Date(),
    });

    return clienteActualizado;
  }

  /**
   * Asienta el rechazo antes de lanzar el error.
   *
   * Una submission que rebota es exactamente la que hay que poder ver desde el panel:
   * el socio ya contestó y cree que terminó, pero del lado del CRM no pasó nada. Sin
   * este registro el problema solo existe en los logs de Apps Script, que quien
   * administra el gimnasio no mira.
   */
  private async rechazar(
    payload: FormSubmission,
    documento: string | undefined,
    motivo: string
  ): Promise<void> {
    await this.submissionRecordRepository.registrar({
      gymId: payload.gymId,
      responseId: payload.responseId,
      documento,
      resultado: 'rechazada',
      motivo,
      recibidaEn: new Date(),
    });
  }
}

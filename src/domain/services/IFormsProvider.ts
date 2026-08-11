/**
 * Validación de los webhooks de formularios de onboarding (hoy, Google Forms).
 */
export interface FormSubmission {
  gymId: string;
  respuestas: Record<string, any>;
  /**
   * Id que Google le da a la respuesta. Es la clave de idempotencia del webhook.
   *
   * Opcional porque no siempre existe: con el trigger instalado sobre la HOJA de
   * respuestas, el evento de Apps Script no trae el id del `FormResponse`. Sin él la
   * submission se procesa igual —perder el dato del socio es peor que perder la
   * deduplicación— pero un reenvío se vuelve a aplicar.
   */
  responseId?: string;
}

export interface IFormsProvider {
  /**
   * `true` solo si el gym existe y el secreto recibido es el suyo.
   *
   * Un gym sin secreto configurado rechaza TODO. No hay secreto de plataforma
   * compartido al que caer: uno solo valdría para todos los tenants y, como el
   * `gymId` viaja en el body de un endpoint público, alcanzaría para inyectar
   * clientes en cualquier gimnasio.
   */
  verificarSecret(gymId: string, secret: string): Promise<boolean>;
}

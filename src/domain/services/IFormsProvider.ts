/**
 * Manejo de webhooks de Google Forms
 */
export interface FormSubmission {
  gymId: string;
  respuestas: Record<string, any>;
}

export interface IFormsProvider {
  /**
   * Valida y procesa la submission del formulario
   */
  processSubmission(webhookSecret: string, payload: FormSubmission): Promise<{
    isValid: boolean;
    gymId?: string;
    respuestas?: Record<string, any>;
  }>;

  /**
   * Obtiene el secret del gym para validación
   */
  getWebhookSecret(gymId: string): Promise<string | null>;
}
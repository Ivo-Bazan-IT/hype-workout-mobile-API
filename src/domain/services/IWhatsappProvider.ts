/**
 * Proveedor de WhatsApp para envío de rutinas.
 * Se obtiene ya configurado (phoneNumberId + accessToken del gym) a través de
 * IWhatsappProviderFactory. Implementado con Meta WhatsApp Cloud API.
 */
export interface IWhatsappProvider {
  /**
   * Envía un PDF como documento adjunto por WhatsApp
   */
  sendPdfDocument(params: {
    to: string;
    pdfBuffer: Buffer;
    filename: string;
  }): Promise<{ messageId: string }>;

  /**
   * Envía un mensaje de texto plano. Lo usa el link de pago de la renovación: no
   * hay archivo que adjuntar, solo una URL que el socio abre para pagar.
   */
  sendTextMessage(params: { to: string; text: string }): Promise<{ messageId: string }>;
}

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
}

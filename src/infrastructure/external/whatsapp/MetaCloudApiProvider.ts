import axios from 'axios';
import { IWhatsappProvider } from '../../../domain/services/IWhatsappProvider';

export class MetaCloudApiProvider implements IWhatsappProvider {
  constructor(
    private phoneNumberId: string,
    private accessToken: string
  ) {}

  async sendPdfDocument(params: {
    to: string;
    pdfBuffer: Buffer;
    filename: string;
  }): Promise<{ messageId: string }> {
    // 1. Subir el media
    const form = new FormData();
    form.append('file', new Blob([params.pdfBuffer], { type: 'application/pdf' }), params.filename);
    form.append('messaging_product', 'whatsapp');

    const uploadRes = await axios.post(
      `https://graph.facebook.com/v20.0/${this.phoneNumberId}/media`,
      form,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      }
    );

    const mediaId = uploadRes.data.id;

    // 2. Enviar el mensaje con el documento adjunto
    const sendRes = await axios.post(
      `https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'document',
        document: { id: mediaId, filename: params.filename }
      },
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      }
    );

    return { messageId: sendRes.data.messages[0].id };
  }
}
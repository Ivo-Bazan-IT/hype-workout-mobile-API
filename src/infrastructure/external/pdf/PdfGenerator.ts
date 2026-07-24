import { IPdfGenerator, PdfTemplateConfig, RoutinePdfData } from '../../../domain/services/IPdfGenerator';
import puppeteer from 'puppeteer';

export class PuppeteerPdfGenerator implements IPdfGenerator {
  async generateFromHtml(params: {
    template: PdfTemplateConfig;
    data: RoutinePdfData;
  }): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();

      // Renderizar HTML con los datos inyectados
      const html = this.renderTemplate(params.template.htmlTemplate, params.data);

      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  private renderTemplate(htmlTemplate: string, data: RoutinePdfData): string {
    // Reemplazar placeholders simples {{campo}} con valores
    let rendered = htmlTemplate;

    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key}}}`;
      rendered = rendered.replaceAll(placeholder, String(value ?? ''));
    }

    // Para el campo rutina (objeto), convertir a JSON legible
    if (data.rutina) {
      const rutinaHtml = this.renderRoutineAsHtml(data.rutina);
      rendered = rendered.replaceAll('{{rutina}}', rutinaHtml);
    }

    return rendered;
  }

  private renderRoutineAsHtml(rutina: Record<string, any>): string {
    // Renderizar la rutina como HTML estructurado
    // Esto puede personalizarse según la estructura esperada de la IA
    if (!rutina || typeof rutina !== 'object') return '';

    let html = '';

    if (rutina.dias) {
      for (const dia of rutina.dias) {
        html += `<div class="dia"><h3>${dia.nombre || 'Día'}</h3><ul>`;
        if (dia.ejercicios) {
          for (const ejercicio of dia.ejercicios) {
            html += `<li>${ejercicio.nombre} - ${ejercicio.series || ''} x ${ejercicio.repeticiones || ''}</li>`;
          }
        }
        html += '</ul></div>';
      }
    }

    return html || JSON.stringify(rutina);
  }
}
import { IPdfGenerator, PdfTemplateConfig, RoutinePdfData } from '../../../domain/services/IPdfGenerator';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';

/** pdf-lib mide en puntos PDF; Puppeteer no acepta esa unidad y sí pulgadas. */
const PUNTOS_POR_PULGADA = 72;

/**
 * Renderiza el contenido con Puppeteer y lo estampa sobre el PDF de fondo con
 * pdf-lib.
 *
 * Dos detalles que hacen que el overlay funcione y que son fáciles de romper:
 *
 *  - Se renderiza con margen 0 y al TAMAÑO EXACTO de la página del fondo. Si el
 *    contenido saliera en A4 y el fondo fuera de otra medida, las dos capas
 *    quedarían desalineadas. El margen del documento lo define el CSS de la
 *    plantilla (su "área segura"), no Puppeteer.
 *  - El HTML no debe pintar fondo propio. Puppeteer deja transparente lo que el
 *    CSS no pinta, y esa transparencia es la que deja ver el arte de abajo.
 */
export class PuppeteerPdfGenerator implements IPdfGenerator {
  async generateFromHtml(params: {
    template: PdfTemplateConfig;
    data: RoutinePdfData;
    fondo?: Buffer | null;
  }): Promise<Buffer> {
    const medidas = params.fondo ? await this.medirFondo(params.fondo) : null;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    let contenido: Buffer;

    try {
      const page = await browser.newPage();

      const html = this.renderTemplate(params.template, params.data);
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        // En pulgadas y no en puntos: Puppeteer solo entiende px/in/cm/mm, y un
        // `595.5pt` (el ancho A4 que reporta pdf-lib) lo rechaza al parsear.
        ...(medidas
          ? {
              width: `${medidas.ancho / PUNTOS_POR_PULGADA}in`,
              height: `${medidas.alto / PUNTOS_POR_PULGADA}in`
            }
          : { format: 'A4' }),
        printBackground: true
        // Sin `margin`: el área segura la declara la plantilla con `@page`, y la
        // opción de Puppeteer la pisaría. Tiene que ser @page y no padding del
        // body porque el padding se aplica una vez al flujo entero: la primera
        // hoja quedaba bien y de la segunda en adelante el texto arrancaba en el
        // borde, encima del encabezado del arte.
      });

      contenido = Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }

    if (!params.fondo) {
      return contenido;
    }

    return this.estamparSobreFondo(contenido, params.fondo);
  }

  /** Tamaño de la primera página del fondo, en puntos PDF. */
  private async medirFondo(fondo: Buffer): Promise<{ ancho: number; alto: number }> {
    const doc = await PDFDocument.load(fondo);
    const primera = doc.getPage(0);

    return { ancho: primera.getWidth(), alto: primera.getHeight() };
  }

  /**
   * Compone las dos capas: para cada página de contenido, dibuja primero el fondo
   * y encima el contenido.
   *
   * Si el contenido tiene más páginas que el fondo (una rutina larga desborda), se
   * repite la ÚLTIMA página del fondo. Así un fondo de una sola página funciona
   * como papel membretado, y uno de dos permite portada + páginas interiores.
   */
  private async estamparSobreFondo(contenido: Buffer, fondo: Buffer): Promise<Buffer> {
    const docContenido = await PDFDocument.load(contenido);
    const docFondo = await PDFDocument.load(fondo);
    const salida = await PDFDocument.create();

    const paginasFondo = await salida.embedPdf(docFondo, docFondo.getPageIndices());
    const paginasContenido = await salida.embedPdf(
      docContenido,
      docContenido.getPageIndices()
    );

    for (const [i, paginaContenido] of paginasContenido.entries()) {
      const paginaFondo = paginasFondo[Math.min(i, paginasFondo.length - 1)];

      const pagina = salida.addPage([paginaFondo.width, paginaFondo.height]);
      pagina.drawPage(paginaFondo);
      pagina.drawPage(paginaContenido);
    }

    return Buffer.from(await salida.save());
  }

  private renderTemplate(template: PdfTemplateConfig, data: RoutinePdfData): string {
    let rendered = template.cssStyles
      ? `<style>${template.cssStyles}</style>${template.htmlTemplate}`
      : template.htmlTemplate;

    // La rutina primero: es HTML generado y no debe volver a pasar por el
    // reemplazo de placeholders (un ejercicio llamado "{{rutina}}" haría un lío)
    rendered = rendered.replaceAll('{{rutina}}', this.renderRoutineAsHtml(data.rutina));

    for (const [key, value] of Object.entries(data)) {
      if (key === 'rutina') continue;
      rendered = rendered.replaceAll(`{{${key}}}`, this.escapar(String(value ?? '')));
    }

    return rendered;
  }

  /**
   * Renderiza la rutina que devolvió la IA.
   *
   * La estructura esperada es `{ dias: [{ nombre, ejercicios: [...] }] }`, que es
   * lo que pide el prompt. Si viene otra cosa, se vuelca el JSON crudo en vez de
   * devolver vacío: un PDF feo con los datos le sirve al socio, uno en blanco no.
   */
  private renderRoutineAsHtml(rutina: Record<string, any>): string {
    if (!rutina || typeof rutina !== 'object') return '';

    if (!Array.isArray(rutina.dias) || rutina.dias.length === 0) {
      return `<pre class="rutina-cruda">${this.escapar(JSON.stringify(rutina, null, 2))}</pre>`;
    }

    return rutina.dias.map((dia: any) => this.renderDia(dia)).join('');
  }

  private renderDia(dia: any): string {
    const ejercicios: any[] = Array.isArray(dia?.ejercicios) ? dia.ejercicios : [];

    const filas = ejercicios
      .map((ej) => {
        const nota = ej?.notas || ej?.nota;

        return (
          '<tr>' +
          `<td class="ejercicio">${this.escapar(ej?.nombre ?? '')}` +
          (nota ? `<span class="nota">${this.escapar(nota)}</span>` : '') +
          '</td>' +
          `<td class="numero">${this.escapar(ej?.series ?? '')}</td>` +
          `<td class="numero">${this.escapar(ej?.repeticiones ?? '')}</td>` +
          `<td class="numero">${this.escapar(ej?.descanso ?? '')}</td>` +
          '</tr>'
        );
      })
      .join('');

    const observacion = dia?.observaciones || dia?.notas;

    return (
      '<div class="dia">' +
      `<h3>${this.escapar(dia?.nombre ?? 'Día')}</h3>` +
      '<table><thead><tr>' +
      '<th>Ejercicio</th><th>Series</th><th>Reps</th><th>Descanso</th>' +
      '</tr></thead>' +
      `<tbody>${filas}</tbody></table>` +
      (observacion ? `<p class="observacion">${this.escapar(observacion)}</p>` : '') +
      '</div>'
    );
  }

  /**
   * Escapa el texto que viene del modelo y de la base.
   *
   * Sin esto, un nombre con `<` o un ejercicio con comillas rompen el HTML y la
   * página sale cortada a la mitad — y el contenido lo produce un LLM, así que no
   * hay ninguna garantía sobre qué caracteres trae.
   */
  private escapar(valor: unknown): string {
    return String(valor ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }
}

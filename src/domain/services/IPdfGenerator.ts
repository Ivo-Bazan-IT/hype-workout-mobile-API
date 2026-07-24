/**
 * Generador de PDF - usando Puppeteer para diseños gráficos/infografías
 * Alternativa: pdf-lib para PDFs con campos fijos
 */
export interface PdfTemplateConfig {
  htmlTemplate: string;
  cssStyles?: string;
}

export interface RoutinePdfData {
  clienteNombre: string;
  fechaVencimiento: string;
  rutina: Record<string, any>; // contenidoGenerado de la rutina
}

export interface IPdfGenerator {
  /**
   * Genera PDF a partir de template HTML + datos
   */
  generateFromHtml(params: {
    template: PdfTemplateConfig;
    data: RoutinePdfData;
  }): Promise<Buffer>;

  /**
   * Genera PDF con overlay de datos sobre plantilla existente
   * (método alternativo - no usado en esta implementación por diseño gráfico)
   */
  generateFromTemplate?(params: {
    templatePath: string;
    data: Record<string, string>;
    fieldsMap: Record<string, { x: number; y: number; page: number; fontSize: number }>;
  }): Promise<Buffer>;
}
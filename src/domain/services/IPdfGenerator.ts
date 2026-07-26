/**
 * Generador de PDF.
 *
 * El documento se arma en DOS CAPAS: un PDF de fondo con el arte (diseñado fuera
 * del sistema) y, estampado encima, el contenido renderizado desde HTML. Se eligió
 * HTML y no coordenadas fijas sobre el fondo porque una rutina es de largo
 * variable — 3 días o 6, 4 ejercicios o 12 — y con posiciones absolutas el
 * contenido se desborda de la página apenas el socio tiene un plan más largo.
 */
export interface PdfTemplateConfig {
  htmlTemplate: string;
  /** CSS extra. Se inyecta como `<style>`; el template ya puede traer el suyo. */
  cssStyles?: string;
}

export interface RoutinePdfData {
  clienteNombre: string;
  gymNombre: string;
  fechaGeneracion: string;
  fechaVencimiento: string;
  rutina: Record<string, any>; // contenidoGenerado de la rutina
}

export interface IPdfGenerator {
  /**
   * Genera el PDF a partir del template HTML + los datos, estampado sobre `fondo`.
   *
   * @param params.fondo PDF de fondo. Si se omite, el PDF sale sin arte en vez de
   *        fallar: una rutina sin diseño le sirve al socio, una rutina que no se
   *        generó no.
   */
  generateFromHtml(params: {
    template: PdfTemplateConfig;
    data: RoutinePdfData;
    fondo?: Buffer | null;
  }): Promise<Buffer>;
}

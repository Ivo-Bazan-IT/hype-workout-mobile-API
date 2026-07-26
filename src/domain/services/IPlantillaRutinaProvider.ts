import { PlantillaPdfResuelta } from '../pdf/routineTemplate';

/**
 * Provee la plantilla standard de la plataforma: el HTML del contenido y el PDF
 * de fondo sobre el que se estampa.
 *
 * Es un puerto y no una constante del dominio porque la plantilla vive en disco
 * (`PDF_TEMPLATE_STORAGE_PATH`), y leer archivos es infraestructura. El dominio
 * solo declara que alguien tiene que poder dársela.
 */
export interface IPlantillaRutinaProvider {
  /**
   * Plantilla standard, con `fuente: 'standard'`.
   *
   * `fondo` puede venir en `null`: el PDF de fondo es opcional y, si falta, la
   * rutina se genera igual sin diseño. Perder el arte es molesto; perder la rutina
   * del socio por un archivo que no está sería mucho peor.
   */
  obtenerStandard(): Promise<PlantillaPdfResuelta>;
}

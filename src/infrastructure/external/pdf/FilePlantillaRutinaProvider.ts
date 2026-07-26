import * as fs from 'fs';
import * as path from 'path';
import { IPlantillaRutinaProvider } from '../../../domain/services/IPlantillaRutinaProvider';
import { PlantillaPdfResuelta } from '../../../domain/pdf/routineTemplate';

/**
 * Lee la plantilla standard desde disco (`PDF_TEMPLATE_STORAGE_PATH`, por defecto
 * `./storage/templates`). Los dos archivos se versionan en el repo: son parte del
 * producto, no datos de runtime.
 *
 *  - `rutina-standard.html` → OBLIGATORIO. Es el contenido; sin él no hay PDF.
 *  - `rutina-standard.pdf`  → OPCIONAL. Es el arte de fondo. Si falta, la rutina se
 *    genera igual, sin diseño: perder el arte es molesto, perder la rutina del
 *    socio por un archivo ausente sería mucho peor.
 */
const ARCHIVO_HTML = 'rutina-standard.html';
const ARCHIVO_FONDO = 'rutina-standard.pdf';

export class FilePlantillaRutinaProvider implements IPlantillaRutinaProvider {
  private readonly templatesDir: string;

  /**
   * Cache en memoria: la plantilla es estática y versionada, y releerla del disco
   * en cada generación no aportaría nada. Reiniciar el proceso la recarga.
   */
  private cache: PlantillaPdfResuelta | null = null;

  constructor(
    templatesDir: string = process.env.PDF_TEMPLATE_STORAGE_PATH || './storage/templates'
  ) {
    this.templatesDir = templatesDir;
  }

  async obtenerStandard(): Promise<PlantillaPdfResuelta> {
    if (this.cache) {
      return this.cache;
    }

    const rutaHtml = path.join(this.templatesDir, ARCHIVO_HTML);

    if (!fs.existsSync(rutaHtml)) {
      throw new Error(
        `No se encontró la plantilla standard del PDF en ${rutaHtml}. ` +
          'Debería estar versionada en el repo: revisá PDF_TEMPLATE_STORAGE_PATH.'
      );
    }

    this.cache = {
      htmlTemplate: fs.readFileSync(rutaHtml, 'utf8'),
      fondo: this.leerFondo(),
      fuente: 'standard',
    };

    return this.cache;
  }

  private leerFondo(): Buffer | null {
    const rutaFondo = path.join(this.templatesDir, ARCHIVO_FONDO);

    if (!fs.existsSync(rutaFondo)) {
      console.warn(
        `⚠️  No hay PDF de fondo en ${rutaFondo}: las rutinas se generan sin diseño. ` +
          `Copiá ahí el archivo ${ARCHIVO_FONDO} para activarlo.`
      );
      return null;
    }

    return fs.readFileSync(rutaFondo);
  }
}

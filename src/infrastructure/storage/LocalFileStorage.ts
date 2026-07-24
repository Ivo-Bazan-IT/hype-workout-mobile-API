import * as fs from 'fs';
import * as path from 'path';
import { IFileStorage } from '../../domain/services/IFileStorage';

/**
 * Almacenamiento en disco local. Encapsula `fs` y la ruta de salida (configurable por
 * env) para que la lógica de negocio no toque el sistema de archivos directamente.
 */
export class LocalFileStorage implements IFileStorage {
  private readonly outputDir: string;

  constructor(outputDir: string = process.env.PDF_OUTPUT_STORAGE_PATH || './storage/generated') {
    this.outputDir = outputDir;
  }

  async save(params: { content: Buffer; filename: string }): Promise<{ url: string }> {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const outputPath = path.join(this.outputDir, params.filename);
    fs.writeFileSync(outputPath, params.content);

    return { url: outputPath };
  }

  async read(url: string): Promise<Buffer> {
    return fs.readFileSync(url);
  }
}

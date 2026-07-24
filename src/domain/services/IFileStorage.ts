/**
 * Almacenamiento de archivos (p. ej. PDFs de rutinas generadas).
 * Abstrae el acceso a disco/almacenamiento para que la lógica de negocio no dependa
 * de `fs` ni de rutas concretas del sistema. Devuelve una `url` opaca (ruta o URL)
 * que luego puede volver a leerse.
 */
export interface IFileStorage {
  save(params: { content: Buffer; filename: string }): Promise<{ url: string }>;
  read(url: string): Promise<Buffer>;
}

/**
 * Genera y verifica los secretos que firman los webhooks entrantes (hoy, los de
 * Google Forms). Abstrae `crypto` y `bcrypt` para que la lógica de negocio no
 * dependa de ellos, igual que `IEncryptionService` hace con el cifrado.
 *
 * A diferencia de `IEncryptionService`, acá NO hay operación inversa: el secreto se
 * guarda hasheado porque solo hace falta verificarlo. Recuperarlo es imposible por
 * diseño, y esa es exactamente la propiedad que se busca.
 */
export interface IWebhookSecretService {
  /**
   * Secreto nuevo en claro. Es el único momento en que existe fuera de un request:
   * quien lo llama tiene que devolvérselo al usuario ahí mismo o se pierde.
   */
  generar(): string;
  hash(secret: string): Promise<string>;
  /** Comparación en tiempo constante: no debe filtrar el secreto por timing. */
  verificar(secret: string, hash: string): Promise<boolean>;
}

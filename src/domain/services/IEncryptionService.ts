/**
 * Servicio de cifrado simétrico para credenciales de tenant (p. ej. API keys de AFIP).
 * Abstrae el algoritmo y la clave maestra para que la lógica de negocio no dependa de
 * `crypto` ni de variables de entorno.
 */
export interface IEncryptionService {
  encrypt(plainText: string): string;
  decrypt(payload: string): string;
}

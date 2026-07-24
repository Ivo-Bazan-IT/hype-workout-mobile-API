import * as crypto from 'crypto';
import { IEncryptionService } from '../../domain/services/IEncryptionService';

export class EncryptionService implements IEncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16; // 16 bytes es el estándar seguro para AES

  // Obtiene y valida la clave maestra desde el entorno
  private static get masterKey(): Buffer {
    const keyHex = process.env.APP_MASTER_KEY;
    if (!keyHex || keyHex.length !== 64) { // 32 bytes en hex = 64 caracteres
      throw new Error('CRITICAL_SECURITY_ERROR: APP_MASTER_KEY inválida o ausente en variables de entorno.');
    }
    return Buffer.from(keyHex, 'hex');
  }

  /**
   * Encripta un string en texto plano.
   * Retorna un payload compuesto por: IV + AuthTag + Texto Encriptado
   */
  public static encrypt(plainText: string): string {
    // Generar un Vector de Inicialización (IV) único e impredecible por cada encriptación
    const iv = crypto.randomBytes(this.IV_LENGTH);

    const cipher = crypto.createCipheriv(this.ALGORITHM, this.masterKey, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // GCM genera un AuthTag que garantiza que el dato no fue manipulado
    const authTag = cipher.getAuthTag();

    // Serializamos en formato seguro para la persistencia
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Desencripta un payload previamente generado por este servicio.
   */
  public static decrypt(cipherText: string): string {
    try {
      const parts = cipherText.split(':');
      if (parts.length !== 3) throw new Error('Formato de cifrado inválido.');

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encryptedText = parts[2];

      const decipher = crypto.createDecipheriv(this.ALGORITHM, this.masterKey, iv);
      decipher.setAuthTag(authTag); // Verificación de integridad matemática

      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch {
      // Previene filtraciones sobre la naturaleza exacta del error criptográfico
      throw new Error('SECURITY_ERROR: Fallo al desencriptar la credencial del tenant.');
    }
  }

  // Métodos de instancia: permiten inyectar este servicio como IEncryptionService.
  // Delegan en la implementación estática para no duplicar la lógica de cifrado.
  encrypt(plainText: string): string {
    return EncryptionService.encrypt(plainText);
  }

  decrypt(payload: string): string {
    return EncryptionService.decrypt(payload);
  }
}
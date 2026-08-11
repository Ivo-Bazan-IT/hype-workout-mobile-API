import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { IWebhookSecretService } from '../../domain/services/IWebhookSecretService';

/** Prefijo reconocible para que un secreto filtrado se identifique de un vistazo. */
const PREFIJO = 'gfw_';
/** 192 bits: sobra contra fuerza bruta y el total queda lejos del tope de 72 bytes de bcrypt. */
const BYTES_DE_ENTROPIA = 24;
const BCRYPT_ROUNDS = 10;

/**
 * Secretos de webhook con bcrypt, el mismo algoritmo con el que ya se guardan las
 * contraseñas de los usuarios (`CreateGymUseCase`).
 *
 * `bcrypt.compare` compara en tiempo constante, así que la verificación no filtra
 * el secreto por timing como sí lo hacía el `!==` que había antes.
 */
export class BcryptWebhookSecretService implements IWebhookSecretService {
  generar(): string {
    return `${PREFIJO}${randomBytes(BYTES_DE_ENTROPIA).toString('hex')}`;
  }

  async hash(secret: string): Promise<string> {
    return bcrypt.hash(secret, BCRYPT_ROUNDS);
  }

  async verificar(secret: string, hash: string): Promise<boolean> {
    // Un hash corrupto o de otro formato hace que bcrypt lance. En un endpoint
    // público eso tiene que ser un rechazo limpio, no un 500 que revele que el
    // dato guardado está roto.
    try {
      return await bcrypt.compare(secret, hash);
    } catch {
      return false;
    }
  }
}

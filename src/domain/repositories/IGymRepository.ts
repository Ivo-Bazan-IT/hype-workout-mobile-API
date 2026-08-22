import { Gym, AiProvider } from '../entities/Gym';
import { CredencialIAResuelta } from '../ai/credentials';

export interface IGymRepository {
  create(gym: Omit<Gym, 'id' | 'createdAt' | 'updatedAt'>): Promise<Gym>;
  findById(id: string): Promise<Gym | null>;
  findByCuit(cuit: string): Promise<Gym | null>;
  findAll(): Promise<Gym[]>;
  update(id: string, data: Partial<Gym>): Promise<Gym | null>;
  delete(id: string): Promise<boolean>; // soft delete (isActive = false)
  /**
   * Identifica al gym por el `user_id` que Mercado Pago le asignó a su cuenta
   * conectada. Es el único dato confiable que trae el webhook de un pago: la
   * notificación no incluye `gymId`, así que este es el punto de entrada para
   * saber con qué tenant hablar antes de poder confirmar nada más.
   */
  findByMercadoPagoUserId(mpUserId: string): Promise<Gym | null>;
}

// Interface for secrets management - not stored in DB
export interface IGymSecretsRepository {
  getWhatsappAccessToken(gymId: string): Promise<string | null>;
  /**
   * Resuelve con qué proveedor, key y modelo se atiende al gym, degradando al
   * proveedor de respaldo si hace falta para no perder la funcionalidad. El orden
   * de preferencia vive en `domain/ai/credentials`.
   *
   * Devuelve un objeto y no la key suelta porque degradar cambia también el
   * proveedor y el modelo, y el caso de uso necesita saber que degradó para
   * atribuir bien el consumo.
   *
   * `null` si no hay ninguna credencial utilizable.
   */
  resolveAiCredentials(
    gymId: string,
    preferido: AiProvider,
    modelPreferido?: string
  ): Promise<CredencialIAResuelta | null>;
  /**
   * Credencial de la cuenta ÚNICA de AFIP SDK (modo `cuenta_unica`, desconectado
   * por ahora — ver `AFIP_BILLING_MODE`). No lleva `gymId`: la cuenta con el
   * proveedor es única para toda la plataforma.
   */
  getAfipApiKey(): Promise<string | null>;
  /**
   * Credenciales de la cuenta PROPIA de AFIP SDK de un gym (modo `cuenta_propia`,
   * activo por default): access token + certificado + clave privada, las tres
   * cifradas en `Gym.afipConfig`. `null` si el gym no cargó ninguna todavía, o si
   * cargó solo alguna de las tres — sin las tres completas no se puede facturar.
   */
  getAfipCredentials(
    gymId: string
  ): Promise<{ accessToken: string; cert: string; key: string } | null>;

  /**
   * Credenciales OAuth de Mercado Pago del gym (cuenta propia, conectada por
   * `PUT /gyms/settings/mercadopago/callback`). `null` si el gym nunca conectó su
   * cuenta.
   */
  getMercadoPagoCredentials(
    gymId: string
  ): Promise<{ accessToken: string; refreshToken: string; expiraEn?: Date } | null>;
}
import { Gym, AiProvider } from '../entities/Gym';
import { CredencialIAResuelta } from '../ai/credentials';

export interface IGymRepository {
  create(gym: Omit<Gym, 'id' | 'createdAt' | 'updatedAt'>): Promise<Gym>;
  findById(id: string): Promise<Gym | null>;
  findByCuit(cuit: string): Promise<Gym | null>;
  findAll(): Promise<Gym[]>;
  update(id: string, data: Partial<Gym>): Promise<Gym | null>;
  delete(id: string): Promise<boolean>; // soft delete (isActive = false)
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
  getAfipApiKey(gymId: string): Promise<string | null>;
}
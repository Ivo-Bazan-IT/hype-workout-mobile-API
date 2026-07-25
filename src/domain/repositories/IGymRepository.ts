import { Gym, AiProvider } from '../entities/Gym';

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
  getAiApiKey(gymId: string, provider: AiProvider): Promise<string | null>;
  getAfipApiKey(gymId: string): Promise<string | null>;
}
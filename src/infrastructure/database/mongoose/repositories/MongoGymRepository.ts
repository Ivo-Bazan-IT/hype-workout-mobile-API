import { GymModel, GymDocument } from '../schemas/GymSchema';
import { IGymRepository } from '../../../../domain/repositories/IGymRepository';
import { IGymSecretsRepository } from '../../../../domain/repositories/IGymRepository';
import { Gym } from '../../../../domain/entities/Gym';
import { GymMapper } from '../../../../domain/entities/Gym';
import { EncryptionService } from '../../../encryption/EncryptionService';

export class MongoGymRepository implements IGymRepository {
  async create(gym: Omit<Gym, 'id' | 'createdAt' | 'updatedAt'>): Promise<Gym> {
    const doc = await GymModel.create({
      name: gym.name,
      businessName: gym.businessName,
      cuit: gym.cuit,
      contactEmail: gym.contactEmail,
      contactPhone: gym.contactPhone,
      isActive: gym.isActive,
      aiConfig: gym.aiConfig,
      whatsappConfig: gym.whatsappConfig,
      pdfTemplate: gym.pdfTemplate,
      googleFormConfig: gym.googleFormConfig,
    });
    return GymMapper.toDomain(doc);
  }

  async findById(id: string): Promise<Gym | null> {
    const doc = await GymModel.findById(id);
    return doc ? GymMapper.toDomain(doc) : null;
  }

  async findByCuit(cuit: string): Promise<Gym | null> {
    const doc = await GymModel.findOne({ cuit });
    return doc ? GymMapper.toDomain(doc) : null;
  }

  async findAll(): Promise<Gym[]> {
    const docs = await GymModel.find({ isActive: true });
    return docs.map(GymMapper.toDomain);
  }

  async update(id: string, data: Partial<Gym>): Promise<Gym | null> {
    const updateData: Partial<GymDocument> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.businessName !== undefined) updateData.businessName = data.businessName;
    if (data.cuit !== undefined) updateData.cuit = data.cuit;
    if (data.contactEmail !== undefined) updateData.contactEmail = data.contactEmail;
    if (data.contactPhone !== undefined) updateData.contactPhone = data.contactPhone;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.aiConfig !== undefined) updateData.aiConfig = data.aiConfig;
    if (data.whatsappConfig !== undefined) updateData.whatsappConfig = data.whatsappConfig;
    if (data.pdfTemplate !== undefined) updateData.pdfTemplate = data.pdfTemplate;
    if (data.googleFormConfig !== undefined) updateData.googleFormConfig = data.googleFormConfig;
    if (data.afipConfig !== undefined) updateData.afipConfig = data.afipConfig;

    const doc = await GymModel.findByIdAndUpdate(id, updateData, { new: true });
    return doc ? GymMapper.toDomain(doc) : null;
  }

  async delete(id: string): Promise<boolean> {
    // Soft delete - isActive = false
    const doc = await GymModel.findByIdAndUpdate(id, { isActive: false });
    return !!doc;
  }
}

// Implementación temporal usando env vars - debería conectarse a secret manager
export class EnvGymSecretsRepository implements IGymSecretsRepository {
  async getWhatsappAccessToken(_gymId: string): Promise<string | null> {
    // En una implementación real, esto leería de AWS Secrets Manager, Doppler, etc.
    // Basado en tokenSecretRef del gym
    // Por ahora devolvemos el default de env:
    return process.env.WHATSAPP_DEFAULT_ACCESS_TOKEN || null;
  }

  async getAiApiKey(_gymId: string, provider: 'openai' | 'anthropic'): Promise<string | null> {
    if (provider === 'openai') return process.env.OPENAI_API_KEY || null;
    if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || null;
    return null;
  }

  async getAfipApiKey(gymId: string): Promise<string | null> {
    // Estrategia de fallback:
    // 1. Primero intentar obtener desde secret manager externo (apiKeySecretRef)
    // 2. Si no hay secret ref, intentar con API key encriptada en BD
    // 3. Fallback a variable de entorno

    const gym = await GymModel.findById(gymId);

    if (!gym || !gym.afipConfig?.isActive) {
      return process.env.AFIP_SDK_API_KEY || null;
    }

    // Priorizar API key encriptada si existe
    if ((gym.afipConfig as any).encryptedApiKey) {
      try {
        return EncryptionService.decrypt((gym.afipConfig as any).encryptedApiKey);
      } catch (error) {
        console.error(`Error decrypting AFIP key for gym ${gymId}:`, error);
      }
    }

    // Fallback a env var
    return process.env.AFIP_SDK_API_KEY || null;
  }
}
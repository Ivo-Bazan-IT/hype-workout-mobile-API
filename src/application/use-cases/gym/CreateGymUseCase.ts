import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import bcrypt from 'bcrypt';

interface CreateGymDTO {
  name: string;
  businessName: string;
  cuit: string;
  contactEmail: string;
  contactPhone: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
  aiProvider?: 'openai' | 'anthropic';
  whatsappPhoneNumberId?: string;
}

export class CreateGymUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private userRepository: IUserRepository
  ) {}

  async execute(dto: CreateGymDTO): Promise<{ gym: any; user: any }> {
    // Verificar CUIT único
    const existingGym = await this.gymRepository.findByCuit(dto.cuit);
    if (existingGym) {
      throw new Error('A gym with this CUIT already exists');
    }

    const existingAdmin = await this.userRepository.findByEmail(dto.adminEmail);
    if (existingAdmin) {
      throw new Error('An admin user with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.adminPassword, 12);

    // Crear gym
    const gym = await this.gymRepository.create({
      name: dto.name,
      businessName: dto.businessName,
      cuit: dto.cuit,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone,
      isActive: true,
      aiConfig: {
        provider: dto.aiProvider || 'openai',
        promptTemplate: '{{respuestas_encuesta}}',
      },
      whatsappConfig: {
        phoneNumberId: dto.whatsappPhoneNumberId || '',
        tokenSecretRef: `whatsapp-${dto.cuit}`,
      },
      pdfTemplate: {},
      googleFormConfig: {},
    });

    // Crear usuario admin del gym
    const user = await this.userRepository.create({
      email: dto.adminEmail,
      passwordHash,
      role: 'gym',
      gymId: gym.id,
      name: dto.adminName,
      isActive: true,
    });

    return { gym, user };
  }
}
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { IEncryptionService } from '../../../domain/services/IEncryptionService';
import { AiProvider } from '../../../domain/entities/Gym';
import { PROMPT_STANDARD } from '../../../domain/prompt/promptStandard';
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
  aiProvider?: AiProvider;
  whatsappPhoneNumberId?: string;
  /**
   * Access token de Meta del gym. Se cifra acá y nunca se devuelve.
   *
   * Se acepta en el alta para que el super-admin pueda dejar el gimnasio listo en
   * una sola operación: antes había que crearlo y después cargarle el token por
   * otra ruta, y un gym a medio configurar no puede mandar rutinas.
   */
  whatsappAccessToken?: string;
  /**
   * Zona horaria del gimnasio (IANA). Se acepta en el alta porque decide qué día
   * calendario es un check-in: un gym dado de alta sin ella agrupa la asistencia con
   * el default hasta que alguien se acuerde de configurarla.
   */
  timezone?: string;
}

export class CreateGymUseCase {
  constructor(
    private gymRepository: IGymRepository,
    private userRepository: IUserRepository,
    private encryptionService: IEncryptionService
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
        // deepseek por defecto: es el más barato por rutina generada
        provider: dto.aiProvider || 'deepseek',
        // El standard, no un volcado pelado de la encuesta: así el gym genera
        // rutinas usables desde el alta, sin tener que configurar nada primero.
        promptTemplate: PROMPT_STANDARD,
      },
      whatsappConfig: {
        phoneNumberId: dto.whatsappPhoneNumberId || '',
        tokenSecretRef: `whatsapp-${dto.cuit}`,
        ...(dto.whatsappAccessToken && {
          encryptedAccessToken: this.encryptionService.encrypt(dto.whatsappAccessToken),
        }),
      },
      pdfTemplate: {},
      googleFormConfig: {},
      // Sin valor por defecto: "no configurada" es un estado distinto de "eligió
      // Buenos Aires", y los endpoints que agrupan por hora devuelven cuál usaron.
      timezone: dto.timezone,
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
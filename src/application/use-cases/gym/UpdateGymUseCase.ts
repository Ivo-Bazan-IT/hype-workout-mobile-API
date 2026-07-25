import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Gym } from '../../../domain/entities/Gym';
import { validatePromptTemplate } from '../../../domain/prompt/promptTemplate';
import { NotFoundError, ConflictError, ValidationError } from '../../../shared/errors/AppError';

export class UpdateGymUseCase {
  constructor(private gymRepository: IGymRepository) {}

  async execute(gymId: string, data: Partial<Gym>): Promise<Gym | null> {
    // Este endpoint (PUT /api/admin/gyms/:id) puede reemplazar aiConfig entero, así
    // que valida el template igual que UpdateAiConfigUseCase: si no, sería una
    // puerta trasera para guardar un prompt sin placeholders.
    if (data.aiConfig?.promptTemplate !== undefined) {
      const error = validatePromptTemplate(data.aiConfig.promptTemplate);
      if (error) {
        throw new ValidationError(error);
      }
    }

    // Verificar que el gym existe
    const existingGym = await this.gymRepository.findById(gymId);
    if (!existingGym) {
      throw new NotFoundError('Gym');
    }

    // Si se actualiza el CUIT, verificar que no esté duplicado
    if (data.cuit && data.cuit !== existingGym.cuit) {
      const duplicateGym = await this.gymRepository.findByCuit(data.cuit);
      if (duplicateGym) {
        throw new ConflictError('A gym with this CUIT already exists');
      }
    }

    return this.gymRepository.update(gymId, data);
  }
}

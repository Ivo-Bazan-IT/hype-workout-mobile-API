import { IGymRepository } from '../../../domain/repositories/IGymRepository';

export class DeleteGymUseCase {
  constructor(private gymRepository: IGymRepository) {}

  async execute(gymId: string): Promise<boolean> {
    // Verificar que el gym existe
    const existingGym = await this.gymRepository.findById(gymId);
    if (!existingGym) {
      throw new Error('Gym not found');
    }

    // Soft delete - isActive = false
    return this.gymRepository.delete(gymId);
  }
}
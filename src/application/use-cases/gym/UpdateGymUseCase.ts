import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Gym } from '../../../domain/entities/Gym';

export class UpdateGymUseCase {
  constructor(private gymRepository: IGymRepository) {}

  async execute(gymId: string, data: Partial<Gym>): Promise<Gym | null> {
    // Verificar que el gym existe
    const existingGym = await this.gymRepository.findById(gymId);
    if (!existingGym) {
      throw new Error('Gym not found');
    }

    // Si se actualiza el CUIT, verificar que no esté duplicado
    if (data.cuit && data.cuit !== existingGym.cuit) {
      const duplicateGym = await this.gymRepository.findByCuit(data.cuit);
      if (duplicateGym) {
        throw new Error('A gym with this CUIT already exists');
      }
    }

    return this.gymRepository.update(gymId, data);
  }
}
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Gym } from '../../../domain/entities/Gym';

export class ListGymsUseCase {
  constructor(private gymRepository: IGymRepository) {}

  async execute(): Promise<Gym[]> {
    return this.gymRepository.findAll();
  }
}
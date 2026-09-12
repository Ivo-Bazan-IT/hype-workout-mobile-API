import { IUserRepository } from '../../../domain/repositories/IUserRepository';

export class SearchEntrenadoresUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(params: { page?: number; limit?: number }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    return await this.userRepository.search({ role: 'entrenador', isActive: true }, page, limit);
  }
}

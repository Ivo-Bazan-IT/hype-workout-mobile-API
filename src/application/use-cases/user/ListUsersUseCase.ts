import { IUserRepository, UserSearchFilters } from '../../../domain/repositories/IUserRepository';
import { PaginatedResult } from '../../../domain/repositories/IClientRepository';
import { User } from '../../../domain/entities/User';

interface ListUsersDTO {
  filters: UserSearchFilters;
  page?: number;
  limit?: number;
}

export class ListUsersUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(dto: ListUsersDTO): Promise<PaginatedResult<User>> {
    return this.userRepository.search(dto.filters, dto.page, dto.limit);
  }
}

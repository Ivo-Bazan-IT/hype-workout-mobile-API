import { IClientRepository, ClientSearchFilters, PaginatedResult } from '../../../domain/repositories/IClientRepository';
import { Client } from '../../../domain/entities/Client';

interface SearchClientsDTO {
  gymId: string;
  filters: ClientSearchFilters;
  page: number;
  limit: number;
}

export class SearchClientsUseCase {
  constructor(private clientRepository: IClientRepository) {}

  async execute(dto: SearchClientsDTO): Promise<PaginatedResult<Client>> {
    return this.clientRepository.search(dto.gymId, dto.filters, dto.page, dto.limit);
  }
}
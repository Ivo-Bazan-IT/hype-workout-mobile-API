import {
  ICheckInRepository,
  CheckInListItem,
  CheckInSearchFilters,
} from '../../../domain/repositories/ICheckInRepository';
import { PaginatedResult } from '../../../domain/repositories/IClientRepository';

interface SearchCheckInsDTO {
  gymId: string;
  filters: CheckInSearchFilters;
  page?: number;
  limit?: number;
}

export class SearchCheckInsUseCase {
  constructor(private checkInRepository: ICheckInRepository) {}

  async execute(dto: SearchCheckInsDTO): Promise<PaginatedResult<CheckInListItem>> {
    return this.checkInRepository.search(dto.gymId, dto.filters, dto.page, dto.limit);
  }
}

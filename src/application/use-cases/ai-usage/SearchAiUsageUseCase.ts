import {
  IAiUsageRepository,
  AiUsageSearchFilters
} from '../../../domain/repositories/IAiUsageRepository';
import { PaginatedResult } from '../../../domain/repositories/IClientRepository';
import { AiUsageRecord } from '../../../domain/entities/AiUsageRecord';
import { ValidationError } from '../../../shared/errors/AppError';

interface SearchAiUsageDTO {
  gymId: string;
  filters: AiUsageSearchFilters;
  page?: number;
  limit?: number;
}

const MAX_LIMIT = 100;

export class SearchAiUsageUseCase {
  constructor(private aiUsageRepository: IAiUsageRepository) {}

  async execute(dto: SearchAiUsageDTO): Promise<PaginatedResult<AiUsageRecord>> {
    const { desde, hasta } = dto.filters;

    if (desde && hasta && desde > hasta) {
      throw new ValidationError('desde cannot be later than hasta');
    }

    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(Math.max(1, dto.limit ?? 20), MAX_LIMIT);

    return this.aiUsageRepository.search(dto.gymId, dto.filters, page, limit);
  }
}

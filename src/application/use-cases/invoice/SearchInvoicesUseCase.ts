import {
  IInvoiceRepository,
  InvoiceSearchFilters
} from '../../../domain/repositories/IInvoiceRepository';
import { PaginatedResult } from '../../../domain/repositories/IClientRepository';
import { Invoice } from '../../../domain/entities/Invoice';
import { ValidationError } from '../../../shared/errors/AppError';

interface SearchInvoicesDTO {
  gymId: string;
  filters: InvoiceSearchFilters;
  page?: number;
  limit?: number;
}

/** Tope de página: evita que un `?limit=100000` traiga la facturación entera. */
const MAX_LIMIT = 100;

export class SearchInvoicesUseCase {
  constructor(private invoiceRepository: IInvoiceRepository) {}

  async execute(dto: SearchInvoicesDTO): Promise<PaginatedResult<Invoice>> {
    const { emitidaDesde, emitidaHasta } = dto.filters;

    if (emitidaDesde && emitidaHasta && emitidaDesde > emitidaHasta) {
      throw new ValidationError('emitidaDesde cannot be later than emitidaHasta');
    }

    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(Math.max(1, dto.limit ?? 20), MAX_LIMIT);

    return this.invoiceRepository.search(dto.gymId, dto.filters, page, limit);
  }
}

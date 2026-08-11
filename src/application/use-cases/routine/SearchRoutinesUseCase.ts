import {
  IRoutineRepository,
  RoutineListItem,
  RoutineSearchFilters,
} from '../../../domain/repositories/IRoutineRepository';
import { PaginatedResult } from '../../../domain/repositories/IClientRepository';
import { ValidationError } from '../../../shared/errors/AppError';

interface SearchRoutinesDTO {
  gymId: string;
  filters: RoutineSearchFilters;
  page?: number;
  limit?: number;
}

/** Tope de página: evita que un `?limit=100000` traiga el historial entero. */
const MAX_LIMIT = 100;

/**
 * Listado de rutinas del gimnasio, paginado y filtrado en la base.
 *
 * La pantalla de rutinas filtraba sobre la página de socios que tenía cargada, así
 * que "pendientes" y "sin rutina" respondían por doce filas y no por el gimnasio. El
 * mismo tope y el mismo criterio de paginado que `SearchInvoicesUseCase`: son la
 * misma clase de listado y no hay razón para que se comporten distinto.
 */
export class SearchRoutinesUseCase {
  constructor(private routineRepository: IRoutineRepository) {}

  async execute(dto: SearchRoutinesDTO): Promise<PaginatedResult<RoutineListItem>> {
    const { vencimientoDesde, vencimientoHasta } = dto.filters;

    if (vencimientoDesde && vencimientoHasta && vencimientoDesde > vencimientoHasta) {
      throw new ValidationError('vencimientoDesde cannot be later than vencimientoHasta');
    }

    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(Math.max(1, dto.limit ?? 20), MAX_LIMIT);

    return this.routineRepository.search(dto.gymId, dto.filters, page, limit);
  }
}

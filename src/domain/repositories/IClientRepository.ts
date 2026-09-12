import { Client, ClientStatus } from '../entities/Client';

/**
 * OJO al agregar un filtro acá: declararlo NO lo implementa.
 *
 * `vencimientoDesde` y `vencimientoHasta` vivieron un tiempo en esta interfaz sin que
 * `MongoClientRepository.buildQuery` los tradujera. Pasarlos no filtraba nada, no
 * fallaba y no avisaba —el adaptador simplemente ignora las claves que no conoce—, así
 * que el conteo de socios activos del dashboard salía mal con todos los tests en verde.
 * Un filtro nuevo no está terminado hasta verlo en la query y cubierto por
 * `tests/integration/client/MongoClientRepository.test.ts`.
 */
export interface ClientSearchFilters {
  query?: string; // nombre texto o documento prefijo
  estado?: ClientStatus;
  esRecurrente?: boolean;
  /** Rango semiabierto sobre `fechaVencimiento`: incluye `desde`, excluye `hasta`. */
  vencimientoDesde?: Date;
  vencimientoHasta?: Date;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface IClientRepository {
  create(client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'esRecurrente' | 'historialRenovaciones'>): Promise<Client>;
  findById(id: string, gymId: string): Promise<Client | null>;
  findByDocumento(documento: string, gymId: string): Promise<Client | null>;
  search(gymId: string, filters: ClientSearchFilters, page?: number, limit?: number): Promise<PaginatedResult<Client>>;
  /**
   * Cuenta sin traer los documentos. Existe para los KPIs: contar clientes
   * paginando y filtrando en memoria rompe apenas el gym pasa el tamaño de página.
   */
  count(gymId: string, filters: ClientSearchFilters): Promise<number>;
  update(id: string, gymId: string, data: Partial<Client>): Promise<Client | null>;
  delete(id: string, gymId: string): Promise<boolean>; // soft delete
  findByUserId(userId: string, gymId: string): Promise<Client | null>;
  getExpiringSoon(gymId: string, days: number): Promise<Client[]>;
}
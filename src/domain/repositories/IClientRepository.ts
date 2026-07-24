import { Client, ClientStatus } from '../entities/Client';

export interface ClientSearchFilters {
  query?: string; // nombre texto o documento prefijo
  estado?: ClientStatus;
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
  update(id: string, gymId: string, data: Partial<Client>): Promise<Client | null>;
  delete(id: string, gymId: string): Promise<boolean>; // soft delete
  getExpiringSoon(gymId: string, days: number): Promise<Client[]>;
}
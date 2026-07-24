import { User, UserRole } from '../entities/User';
import { PaginatedResult } from './IClientRepository';

export interface UserSearchFilters {
  query?: string; // nombre o email (parcial, case-insensitive)
  role?: UserRole;
  gymId?: string;
  isActive?: boolean;
}

export interface IUserRepository {
  create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  // Listado a nivel plataforma: NO se filtra por gymId porque el super-admin
  // administra usuarios de todos los tenants. El aislamiento lo garantiza
  // requireAdmin en la ruta, no el repositorio.
  search(filters: UserSearchFilters, page?: number, limit?: number): Promise<PaginatedResult<User>>;
  update(id: string, data: Partial<User>): Promise<User | null>;
  delete(id: string): Promise<boolean>;
}

export interface IUserTokenPayload {
  userId: string;
  email: string;
  role: 'admin' | 'gym';
  gymId?: string;
}

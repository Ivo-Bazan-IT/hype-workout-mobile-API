import { User } from '../entities/User';

export interface IUserRepository {
  create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  update(id: string, data: Partial<User>): Promise<User | null>;
  delete(id: string): Promise<boolean>;
  // Not needed for multi-tenant: we don't list all users (admin has separate endpoints)
}

export interface IUserTokenPayload {
  userId: string;
  email: string;
  role: 'admin' | 'gym';
  gymId?: string;
}
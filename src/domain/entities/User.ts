import { Types } from 'mongoose';

export type UserRole = 'admin' | 'gym';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  gymId?: string | null;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class UserEntity implements User {
  constructor(
    public id: string,
    public email: string,
    public passwordHash: string,
    public role: UserRole,
    public name: string,
    public isActive: boolean = true,
    public gymId: string | null = null,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class UserMapper {
  static toDomain(doc: any): User {
    return new UserEntity(
      doc._id.toString(),
      doc.email,
      doc.passwordHash,
      doc.role,
      doc.name,
      doc.isActive,
      doc.gymId?.toString(),
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: UserEntity): any {
    return {
      _id: entity.id,
      email: entity.email,
      passwordHash: entity.passwordHash,
      role: entity.role,
      gymId: entity.gymId ? new Types.ObjectId(entity.gymId) : undefined,
      name: entity.name,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
import { UserModel, UserDocument } from '../schemas/UserSchema';
import { IUserRepository, UserSearchFilters } from '../../../../domain/repositories/IUserRepository';
import { PaginatedResult } from '../../../../domain/repositories/IClientRepository';
import { User } from '../../../../domain/entities/User';
import { UserMapper } from '../../../../domain/entities/User';

export class MongoUserRepository implements IUserRepository {
  async create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const doc = await UserModel.create({
      email: user.email,
      passwordHash: user.passwordHash,
      role: user.role,
      gymId: user.gymId,
      entrenadorId: user.entrenadorId,
      name: user.name,
      isActive: user.isActive,
    });
    return UserMapper.toDomain(doc);
  }

  async findById(id: string): Promise<User | null> {
    const doc = await UserModel.findById(id);
    return doc ? UserMapper.toDomain(doc) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const doc = await UserModel.findOne({ email: email.toLowerCase() });
    return doc ? UserMapper.toDomain(doc) : null;
  }

  async search(
    filters: UserSearchFilters,
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResult<User>> {
    const skip = (page - 1) * limit;
    const query: any = {};

    if (filters.query) {
      // Búsqueda parcial por nombre o email
      query.$or = [
        { name: { $regex: filters.query, $options: 'i' } },
        { email: { $regex: filters.query, $options: 'i' } }
      ];
    }

    if (filters.role) {
      query.role = filters.role;
    }

    if (filters.gymId) {
      query.gymId = filters.gymId;
    }

    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }

    const [docs, total] = await Promise.all([
      UserModel.find(query).skip(skip).limit(limit).sort({ createdAt: -1 }),
      UserModel.countDocuments(query)
    ]);

    return {
      data: docs.map(UserMapper.toDomain),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    // Copia campo a campo: `role` queda deliberadamente fuera para que ninguna
    // actualización pueda escalar un usuario 'gym' a 'admin'.
    const updateData: Partial<UserDocument> = {};

    if (data.email !== undefined) updateData.email = data.email;
    if (data.passwordHash !== undefined) updateData.passwordHash = data.passwordHash;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.gymId !== undefined && data.gymId !== null) {
      updateData.gymId = data.gymId as unknown as UserDocument['gymId'];
    }
    if (data.entrenadorId !== undefined && data.entrenadorId !== null) {
      updateData.entrenadorId = data.entrenadorId as unknown as UserDocument['entrenadorId'];
    }

    const doc = await UserModel.findByIdAndUpdate(id, updateData, { new: true });
    return doc ? UserMapper.toDomain(doc) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await UserModel.findByIdAndDelete(id);
    return !!result;
  }
}

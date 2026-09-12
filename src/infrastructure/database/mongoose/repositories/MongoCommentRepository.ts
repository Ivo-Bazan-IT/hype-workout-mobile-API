import { Types } from 'mongoose';
import { ICommentRepository } from '../../../../domain/repositories/ICommentRepository';
import { RoutineComment } from '../../../../domain/entities/RoutineComment';
import { RoutineCommentModel } from '../schemas/RoutineCommentSchema';

export class MongoCommentRepository implements ICommentRepository {
  async create(data: Partial<RoutineComment>): Promise<RoutineComment> {
    const doc = await RoutineCommentModel.create({
      gymId: new Types.ObjectId(data.gymId),
      routineId: new Types.ObjectId(data.routineId),
      clientId: new Types.ObjectId(data.clientId ?? ''),
      autorUserId: new Types.ObjectId(data.autorUserId),
      autorRol: data.autorRol,
      texto: data.texto,
      createdAt: data.createdAt ?? new Date(),
    });
    return this.toDomain(doc);
  }

  async findByRoutineId(routineId: string, gymId: string): Promise<RoutineComment[]> {
    const docs = await RoutineCommentModel.find({ routineId: new Types.ObjectId(routineId), gymId: new Types.ObjectId(gymId) }).sort({ createdAt: 1 });
    return docs.map(this.toDomain);
  }

  private toDomain(doc: any): RoutineComment {
    return {
      id: doc._id.toString(),
      gymId: doc.gymId.toString(),
      routineId: doc.routineId.toString(),
      clientId: doc.clientId?.toString() ?? '',
      autorUserId: doc.autorUserId.toString(),
      autorRol: doc.autorRol,
      texto: doc.texto,
      createdAt: doc.createdAt,
    };
  }
}

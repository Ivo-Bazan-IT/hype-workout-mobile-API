import { Types } from 'mongoose';
import { IProgressUpdateRepository } from '../../../../domain/repositories/IProgressUpdateRepository';
import { RoutineProgressUpdate } from '../../../../domain/entities/RoutineProgressUpdate';
import { RoutineProgressUpdateModel } from '../schemas/RoutineProgressUpdateSchema';

export class MongoProgressUpdateRepository implements IProgressUpdateRepository {
  async create(data: Partial<RoutineProgressUpdate>): Promise<RoutineProgressUpdate> {
    const doc = await RoutineProgressUpdateModel.create({
      gymId: new Types.ObjectId(data.gymId),
      routineId: new Types.ObjectId(data.routineId),
      clientId: new Types.ObjectId(data.clientId),
      semana: data.semana,
      datos: data.datos,
      estado: data.estado ?? 'pendiente_revision',
      createdAt: data.createdAt ?? new Date(),
      updatedAt: data.updatedAt ?? new Date(),
    });
    return this.toDomain(doc);
  }

  async findByRoutineId(routineId: string, gymId: string): Promise<RoutineProgressUpdate[]> {
    const docs = await RoutineProgressUpdateModel.find({ routineId: new Types.ObjectId(routineId), gymId: new Types.ObjectId(gymId) }).sort({ semana: 1 });
    return docs.map(this.toDomain);
  }

  async findByGymClientSemana(gymId: string, clientId: string, semana: number): Promise<RoutineProgressUpdate | null> {
    const doc = await RoutineProgressUpdateModel.findOne({ gymId: new Types.ObjectId(gymId), clientId: new Types.ObjectId(clientId), semana });
    return doc ? this.toDomain(doc) : null;
  }

  async update(id: string, gymId: string, data: Partial<RoutineProgressUpdate>): Promise<RoutineProgressUpdate | null> {
    const updateData: any = {};
    if (data.datos !== undefined) updateData.datos = data.datos;
    if (data.estado !== undefined) updateData.estado = data.estado;
    const doc = await RoutineProgressUpdateModel.findOneAndUpdate({ _id: id, gymId: new Types.ObjectId(gymId) }, updateData, { new: true });
    return doc ? this.toDomain(doc) : null;
  }

  async searchPendientesByGym(gymId: string): Promise<RoutineProgressUpdate[]> {
    const docs = await RoutineProgressUpdateModel.find({ gymId: new Types.ObjectId(gymId), estado: 'pendiente_revision' }).sort({ createdAt: -1 });
    return docs.map(this.toDomain);
  }

  private toDomain(doc: any): RoutineProgressUpdate {
    return {
      id: doc._id.toString(),
      gymId: doc.gymId.toString(),
      routineId: doc.routineId.toString(),
      clientId: doc.clientId.toString(),
      semana: doc.semana,
      datos: doc.datos,
      estado: doc.estado,
      createdAt: doc.createdAt ?? doc.createdAt,
      updatedAt: doc.updatedAt ?? doc.updatedAt,
    };
  }
}

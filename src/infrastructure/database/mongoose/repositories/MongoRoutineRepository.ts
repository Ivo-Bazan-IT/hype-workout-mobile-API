import { RoutineModel, RoutineDocument } from '../schemas/RoutineSchema';
import { IRoutineRepository } from '../../../../domain/repositories/IRoutineRepository';
import { Routine } from '../../../../domain/entities/Routine';
import { RoutineMapper } from '../../../../domain/entities/Routine';

export class MongoRoutineRepository implements IRoutineRepository {
  async create(routine: Omit<Routine, 'id' | 'createdAt' | 'updatedAt' | 'estadoGeneracion' | 'estadoEnvio'>): Promise<Routine> {
    const doc = await RoutineModel.create({
      gymId: routine.gymId,
      clientId: routine.clientId,
      promptUsado: routine.promptUsado,
      contenidoGenerado: routine.contenidoGenerado,
      pdfUrl: routine.pdfUrl,
      estadoGeneracion: 'pendiente',
      estadoEnvio: 'pendiente',
      fechaVencimiento: routine.fechaVencimiento,
    });
    return RoutineMapper.toDomain(doc);
  }

  async findById(id: string, gymId: string): Promise<Routine | null> {
    const doc = await RoutineModel.findOne({ _id: id, gymId });
    return doc ? RoutineMapper.toDomain(doc) : null;
  }

  async findByClientId(clientId: string, gymId: string): Promise<Routine[]> {
    // gymId siempre presente: aislamiento multi-tenant obligatorio (ver IRoutineRepository)
    const docs = await RoutineModel.find({ clientId, gymId }).sort({ createdAt: -1 });
    return docs.map(RoutineMapper.toDomain);
  }

  async update(id: string, gymId: string, data: Partial<Routine>): Promise<Routine | null> {
    const updateData: Partial<RoutineDocument> = {};

    if (data.promptUsado !== undefined) updateData.promptUsado = data.promptUsado;
    if (data.contenidoGenerado !== undefined) updateData.contenidoGenerado = data.contenidoGenerado;
    if (data.pdfUrl !== undefined) updateData.pdfUrl = data.pdfUrl;
    if (data.estadoGeneracion !== undefined) updateData.estadoGeneracion = data.estadoGeneracion;
    if (data.estadoEnvio !== undefined) updateData.estadoEnvio = data.estadoEnvio;
    if (data.whatsappMessageId !== undefined) updateData.whatsappMessageId = data.whatsappMessageId;
    if (data.fechaGeneracion !== undefined) updateData.fechaGeneracion = data.fechaGeneracion;

    const doc = await RoutineModel.findOneAndUpdate(
      { _id: id, gymId },
      updateData,
      { new: true }
    );
    return doc ? RoutineMapper.toDomain(doc) : null;
  }

  async updateStatus(
    id: string,
    gymId: string,
    estadoGeneracion: 'pendiente' | 'generando' | 'generado' | 'error',
    estadoEnvio?: 'pendiente' | 'enviando' | 'enviado' | 'error'
  ): Promise<Routine | null> {
    const updateData: Partial<RoutineDocument> = { estadoGeneracion };
    if (estadoEnvio) updateData.estadoEnvio = estadoEnvio;

    const doc = await RoutineModel.findOneAndUpdate(
      { _id: id, gymId },
      updateData,
      { new: true }
    );
    return doc ? RoutineMapper.toDomain(doc) : null;
  }

  async getExpiringSoon(gymId: string, days: number): Promise<Routine[]> {
    const target = new Date();
    target.setDate(target.getDate() + days);
    const startOfDay = new Date(target.setHours(0, 0, 0, 0));
    const endOfDay = new Date(target.setHours(23, 59, 59, 999));

    const docs = await RoutineModel.find({
      gymId,
      fechaVencimiento: { $gte: startOfDay, $lte: endOfDay },
    });
    return docs.map(RoutineMapper.toDomain);
  }

  async countExpiringByDay(gymId: string, days: number): Promise<number> {
    const target = new Date();
    target.setDate(target.getDate() + days);
    const startOfDay = new Date(target.setHours(0, 0, 0, 0));
    const endOfDay = new Date(target.setHours(23, 59, 59, 999));

    return RoutineModel.countDocuments({
      gymId,
      fechaVencimiento: { $gte: startOfDay, $lte: endOfDay },
    });
  }
}
import {
  IAiUsageRepository,
  AiUsageSearchFilters,
  CreateAiUsageInput,
  AiUsageReport,
  AiUsageMonthBucket,
  AiUsageModelBucket
} from '../../../../domain/repositories/IAiUsageRepository';
import { PaginatedResult } from '../../../../domain/repositories/IClientRepository';
import { AiUsageRecord, AiUsageRecordMapper } from '../../../../domain/entities/AiUsageRecord';
import { AiUsageModel, AiUsageDbDocument } from '../schemas/AiUsageSchema';
import { Types, FilterQuery } from 'mongoose';

export class MongoAiUsageRepository implements IAiUsageRepository {
  async create(record: CreateAiUsageInput): Promise<AiUsageRecord> {
    const doc = await AiUsageModel.create({
      gymId: new Types.ObjectId(record.gymId),
      clientId: new Types.ObjectId(record.clientId),
      routineId: new Types.ObjectId(record.routineId),
      provider: record.provider,
      model: record.model,
      tokensPrompt: record.tokensPrompt,
      tokensRespuesta: record.tokensRespuesta,
      tokensTotal: record.tokensTotal,
      costoEstimado: record.costoEstimado
    });

    return AiUsageRecordMapper.toDomain(doc);
  }

  async search(
    gymId: string,
    filters: AiUsageSearchFilters,
    page = 1,
    limit = 20
  ): Promise<PaginatedResult<AiUsageRecord>> {
    const query = this.buildQuery(gymId, filters);
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      AiUsageModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      AiUsageModel.countDocuments(query)
    ]);

    return {
      data: docs.map(AiUsageRecordMapper.toDomain),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  async getUsageByPeriod(gymId: string, desde: Date, hasta: Date): Promise<AiUsageReport> {
    const match = {
      gymId: new Types.ObjectId(gymId),
      createdAt: { $gte: desde, $lte: hasta }
    };

    const [porMesRaw, porModeloRaw, sinPrecio] = await Promise.all([
      AiUsageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            tokensTotal: { $sum: '$tokensTotal' },
            // $sum ignora los null, así que las rutinas sin precio no ensucian el total
            costoEstimado: { $sum: '$costoEstimado' },
            rutinas: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),
      AiUsageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: { provider: '$provider', model: '$model' },
            tokensTotal: { $sum: '$tokensTotal' },
            costoEstimado: { $sum: '$costoEstimado' },
            rutinas: { $sum: 1 }
          }
        },
        { $sort: { costoEstimado: -1 } }
      ]),
      AiUsageModel.countDocuments({ ...match, costoEstimado: null })
    ]);

    const porMes: AiUsageMonthBucket[] = porMesRaw.map((b) => ({
      year: b._id.year,
      month: b._id.month,
      tokensTotal: b.tokensTotal,
      costoEstimado: this.redondear(b.costoEstimado),
      rutinas: b.rutinas
    }));

    const porModelo: AiUsageModelBucket[] = porModeloRaw.map((b) => ({
      provider: b._id.provider,
      model: b._id.model,
      tokensTotal: b.tokensTotal,
      costoEstimado: this.redondear(b.costoEstimado),
      rutinas: b.rutinas
    }));

    return {
      desde,
      hasta,
      tokensTotal: porMes.reduce((acc, b) => acc + b.tokensTotal, 0),
      costoEstimado: this.redondear(porMes.reduce((acc, b) => acc + b.costoEstimado, 0)),
      rutinas: porMes.reduce((acc, b) => acc + b.rutinas, 0),
      rutinasSinPrecio: sinPrecio,
      porMes,
      porModelo
    };
  }

  private buildQuery(
    gymId: string,
    filters: AiUsageSearchFilters
  ): FilterQuery<AiUsageDbDocument> {
    const query: FilterQuery<AiUsageDbDocument> = { gymId: new Types.ObjectId(gymId) };

    if (filters.clientId) query.clientId = new Types.ObjectId(filters.clientId);
    if (filters.routineId) query.routineId = new Types.ObjectId(filters.routineId);
    if (filters.provider) query.provider = filters.provider;
    if (filters.model) query.model = filters.model;

    if (filters.desde || filters.hasta) {
      query.createdAt = {
        ...(filters.desde && { $gte: filters.desde }),
        ...(filters.hasta && { $lte: filters.hasta })
      };
    }

    return query;
  }

  /** Evita que la suma de floats arrastre ruido tipo 0.30000000000000004 */
  private redondear(valor: number): number {
    return Number((valor || 0).toFixed(6));
  }
}

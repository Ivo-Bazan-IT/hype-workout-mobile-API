import {
  IInvoiceRepository,
  InvoiceSearchFilters,
  CreateInvoiceInput,
  RevenueReport,
  RevenuePeriodBucket
} from '../../../../domain/repositories/IInvoiceRepository';
import { PaginatedResult } from '../../../../domain/repositories/IClientRepository';
import { Invoice, InvoiceMapper } from '../../../../domain/entities/Invoice';
import { InvoiceModel, InvoiceDbDocument } from '../schemas/InvoiceSchema';
import { Types, FilterQuery } from 'mongoose';

export class MongoInvoiceRepository implements IInvoiceRepository {
  async create(invoice: CreateInvoiceInput): Promise<Invoice> {
    const doc = await InvoiceModel.create({
      gymId: new Types.ObjectId(invoice.gymId),
      clientId: new Types.ObjectId(invoice.clientId),
      tipoComprobante: invoice.tipoComprobante,
      cae: invoice.cae,
      monto: invoice.monto,
      fechaEmision: invoice.fechaEmision || new Date(),
      estado: invoice.estado || 'pendiente',
      errorLog: invoice.errorLog
    });

    return InvoiceMapper.toDomain(doc);
  }

  async findById(id: string, gymId: string): Promise<Invoice | null> {
    const doc = await InvoiceModel.findOne({ _id: id, gymId });
    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  async search(
    gymId: string,
    filters: InvoiceSearchFilters,
    page = 1,
    limit = 20
  ): Promise<PaginatedResult<Invoice>> {
    const query = this.buildQuery(gymId, filters);
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      // Más reciente primero: el historial se lee de arriba hacia abajo
      InvoiceModel.find(query).sort({ fechaEmision: -1 }).skip(skip).limit(limit),
      InvoiceModel.countDocuments(query)
    ]);

    return {
      data: docs.map(InvoiceMapper.toDomain),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  async update(id: string, gymId: string, data: Partial<Invoice>): Promise<Invoice | null> {
    const updateData: Partial<InvoiceDbDocument> = {};

    if (data.estado !== undefined) updateData.estado = data.estado;
    if (data.cae !== undefined) updateData.cae = data.cae;
    if (data.errorLog !== undefined) updateData.errorLog = data.errorLog;

    const doc = await InvoiceModel.findOneAndUpdate({ _id: id, gymId }, updateData, { new: true });
    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  async sumRevenueByMonth(gymId: string, year: number, month: number): Promise<number> {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const result = await InvoiceModel.aggregate([
      {
        $match: {
          gymId: new Types.ObjectId(gymId),
          fechaEmision: { $gte: startOfMonth, $lte: endOfMonth },
          estado: 'emitida'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$monto' }
        }
      }
    ]);

    return result[0]?.total || 0;
  }

  async getRevenueByPeriod(gymId: string, desde: Date, hasta: Date): Promise<RevenueReport> {
    // Solo 'emitida' cuenta como ingreso: las facturas en 'error' quedan
    // persistidas para auditoría pero no representan plata cobrada.
    const match = {
      gymId: new Types.ObjectId(gymId),
      fechaEmision: { $gte: desde, $lte: hasta },
      estado: 'emitida'
    };

    const buckets = await InvoiceModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { year: { $year: '$fechaEmision' }, month: { $month: '$fechaEmision' } },
          total: { $sum: '$monto' },
          cantidad: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const porMes: RevenuePeriodBucket[] = buckets.map((b) => ({
      year: b._id.year,
      month: b._id.month,
      total: b.total,
      cantidad: b.cantidad
    }));

    // El total sale de sumar los buckets: una segunda agregación podría diferir si
    // entran facturas nuevas entre ambas consultas.
    return {
      desde,
      hasta,
      total: porMes.reduce((acc, b) => acc + b.total, 0),
      cantidad: porMes.reduce((acc, b) => acc + b.cantidad, 0),
      porMes
    };
  }

  private buildQuery(
    gymId: string,
    filters: InvoiceSearchFilters
  ): FilterQuery<InvoiceDbDocument> {
    const query: FilterQuery<InvoiceDbDocument> = { gymId: new Types.ObjectId(gymId) };

    if (filters.clientId) {
      query.clientId = new Types.ObjectId(filters.clientId);
    }

    if (filters.estado) {
      query.estado = filters.estado;
    }

    if (filters.tipoComprobante) {
      query.tipoComprobante = filters.tipoComprobante;
    }

    if (filters.cae) {
      query.cae = filters.cae;
    }

    if (filters.emitidaDesde || filters.emitidaHasta) {
      query.fechaEmision = {
        ...(filters.emitidaDesde && { $gte: filters.emitidaDesde }),
        ...(filters.emitidaHasta && { $lte: filters.emitidaHasta })
      };
    }

    return query;
  }
}

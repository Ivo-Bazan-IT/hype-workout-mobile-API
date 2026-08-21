import {
  IInvoiceRepository,
  InvoiceSearchFilters,
  CreateInvoiceInput,
  RevenueReport,
  RevenuePeriodBucket
} from '../../../../domain/repositories/IInvoiceRepository';
import { PaginatedResult } from '../../../../domain/repositories/IClientRepository';
import { Invoice, InvoiceMapper } from '../../../../domain/entities/Invoice';
import { ResultadoEmision } from '../../../../domain/billing/types';
import { InvoiceModel, InvoiceDbDocument } from '../schemas/InvoiceSchema';
import { Types, FilterQuery } from 'mongoose';

export class MongoInvoiceRepository implements IInvoiceRepository {
  async create(invoice: CreateInvoiceInput): Promise<Invoice> {
    const doc = await InvoiceModel.create({
      gymId: new Types.ObjectId(invoice.gymId),
      clientId: new Types.ObjectId(invoice.clientId),
      tipoComprobante: invoice.tipoComprobante,
      codigoTipoComprobante: invoice.codigoTipoComprobante,
      puntoVenta: invoice.puntoVenta,
      numeroComprobante: invoice.numeroComprobante,
      cae: invoice.cae ?? '',
      vencimientoCae: invoice.vencimientoCae,
      monto: invoice.monto,
      neto: invoice.neto,
      iva: invoice.iva,
      descripcion: invoice.descripcion,
      fechaEmision: invoice.fechaEmision || new Date(),
      estado: invoice.estado || 'pendiente',
      errorLog: invoice.errorLog,
      intentos: invoice.intentos ?? 0,
      proximoIntento: invoice.proximoIntento ?? new Date()
    });

    return InvoiceMapper.toDomain(doc);
  }

  async findById(id: string, gymId: string): Promise<Invoice | null> {
    const doc = await InvoiceModel.findOne({ _id: id, gymId });
    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  /**
   * Reserva atómica: un solo `findOneAndUpdate` busca, marca y devuelve. Mongo
   * garantiza que dos llamadas concurrentes no se lleven el mismo documento, que es
   * justo lo que evita emitir dos veces la misma cuota.
   *
   * El `$inc` de `intentos` va acá, al TOMAR la factura y no al fallar, para que un
   * proceso que se muere en medio de la emisión igual gaste su intento: si no, una
   * factura que hace crashear al worker lo haría reintentar para siempre.
   */
  async claimPendiente(leaseMs: number): Promise<Invoice | null> {
    const ahora = new Date();

    const doc = await InvoiceModel.findOneAndUpdate(
      { estado: 'pendiente', proximoIntento: { $lte: ahora } },
      {
        $inc: { intentos: 1 },
        $set: { proximoIntento: new Date(ahora.getTime() + leaseMs) }
      },
      // La más vieja primero: si algo se atrasó, no queda al fondo para siempre.
      { new: true, sort: { proximoIntento: 1 } }
    );

    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  async marcarEmitida(
    id: string,
    gymId: string,
    resultado: ResultadoEmision,
    fechaEmision: Date
  ): Promise<Invoice | null> {
    const doc = await InvoiceModel.findOneAndUpdate(
      { _id: id, gymId },
      {
        $set: {
          estado: 'emitida',
          cae: resultado.cae,
          vencimientoCae: resultado.vencimientoCae,
          numeroComprobante: resultado.numeroComprobante,
          puntoVenta: resultado.puntoVenta,
          codigoTipoComprobante: resultado.codigoTipoComprobante,
          tipoComprobante: resultado.tipoComprobante,
          neto: resultado.neto,
          iva: resultado.iva,
          monto: resultado.importeTotal,
          fechaEmision
        },
        // Sale de la cola y deja de arrastrar el error de los intentos previos: la
        // factura ya está autorizada y un errorLog viejo solo confunde al que la lee.
        $unset: { proximoIntento: '', errorLog: '' }
      },
      { new: true }
    );

    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  async marcarFallo(
    id: string,
    gymId: string,
    fallo: { estado: 'pendiente' | 'error'; errorLog: string; proximoIntento?: Date }
  ): Promise<Invoice | null> {
    const doc = await InvoiceModel.findOneAndUpdate(
      { _id: id, gymId },
      fallo.proximoIntento
        ? { $set: { estado: fallo.estado, errorLog: fallo.errorLog, proximoIntento: fallo.proximoIntento } }
        : // Sin próximo intento la factura sale de la cola: solo vuelve si alguien
          // la reencola a mano desde el endpoint de reintento.
          { $set: { estado: fallo.estado, errorLog: fallo.errorLog }, $unset: { proximoIntento: '' } },
      { new: true }
    );

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
    // Allowlist explícito. `gymId`, `clientId` y los importes no se tocan por acá:
    // reasignar una factura de tenant o cambiarle el monto no es una edición, es
    // adulterar un comprobante fiscal.
    const updateData: Partial<InvoiceDbDocument> = {};

    if (data.estado !== undefined) updateData.estado = data.estado;
    if (data.cae !== undefined) updateData.cae = data.cae;
    if (data.errorLog !== undefined) updateData.errorLog = data.errorLog;
    if (data.intentos !== undefined) updateData.intentos = data.intentos;
    if (data.proximoIntento !== undefined) updateData.proximoIntento = data.proximoIntento;

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

import { IInvoiceRepository, InvoiceDocument } from '../../../../domain/repositories/IInvoiceRepository';
import { InvoiceModel, InvoiceDbDocument } from '../schemas/InvoiceSchema';
import { Types } from 'mongoose';

export class MongoInvoiceRepository implements IInvoiceRepository {
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

  async create(invoice: Omit<InvoiceDocument, '_id' | 'createdAt' | 'updatedAt'>): Promise<InvoiceDocument> {
    const doc = await InvoiceModel.create({
      gymId: new Types.ObjectId(invoice.gymId as string),
      clientId: new Types.ObjectId(invoice.clientId as string),
      tipoComprobante: invoice.tipoComprobante,
      cae: invoice.cae,
      monto: invoice.monto,
      fechaEmision: invoice.fechaEmision || new Date(),
      estado: invoice.estado || 'pendiente',
      errorLog: invoice.errorLog
    });

    return {
      _id: doc._id.toString(),
      gymId: doc.gymId.toString(),
      clientId: doc.clientId.toString(),
      tipoComprobante: doc.tipoComprobante,
      cae: doc.cae,
      monto: doc.monto,
      fechaEmision: doc.fechaEmision,
      estado: doc.estado,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }

  async update(id: string, data: Partial<InvoiceDocument>): Promise<InvoiceDocument | null> {
    const updateData: Partial<InvoiceDbDocument> = {};

    if (data.estado !== undefined) updateData.estado = data.estado;
    if (data.cae !== undefined) updateData.cae = data.cae;
    if (data.errorLog !== undefined) updateData.errorLog = data.errorLog;

    const doc = await InvoiceModel.findByIdAndUpdate(id, updateData, { new: true });

    if (!doc) return null;

    return {
      _id: doc._id.toString(),
      gymId: doc.gymId.toString(),
      clientId: doc.clientId.toString(),
      tipoComprobante: doc.tipoComprobante,
      cae: doc.cae,
      monto: doc.monto,
      fechaEmision: doc.fechaEmision,
      estado: doc.estado,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }

  async findById(id: string): Promise<InvoiceDocument | null> {
    const doc = await InvoiceModel.findById(id);
    if (!doc) return null;

    return {
      _id: doc._id.toString(),
      gymId: doc.gymId.toString(),
      clientId: doc.clientId.toString(),
      tipoComprobante: doc.tipoComprobante,
      cae: doc.cae,
      monto: doc.monto,
      fechaEmision: doc.fechaEmision,
      estado: doc.estado,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }
}
import { Types } from 'mongoose';
import { IServicePaymentRequestRepository } from '../../../../domain/repositories/IServicePaymentRequestRepository';
import { ServicePaymentRequest } from '../../../../domain/entities/ServicePaymentRequest';
import { ServicePaymentRequestModel } from '../schemas/ServicePaymentRequestSchema';

export class MongoServicePaymentRequestRepository implements IServicePaymentRequestRepository {
  async create(data: Partial<ServicePaymentRequest>): Promise<ServicePaymentRequest> {
    const doc = await ServicePaymentRequestModel.create({
      gymId: new Types.ObjectId(data.gymId),
      clientId: new Types.ObjectId(data.clientId),
      servicioId: data.servicioId,
      tipo: data.tipo ?? 'servicio',
      referencia: data.referencia ?? { servicioId: data.servicioId },
      monto: data.monto,
      estado: data.estado ?? 'pendiente',
      mercadoPagoPaymentLinkId: data.mercadoPagoPaymentLinkId,
      initPoint: data.initPoint,
      creadoEn: data.creadoEn ?? new Date(),
      actualizadoEn: data.actualizadoEn ?? new Date(),
    });
    return this.toDomain(doc);
  }

  async findById(id: string, gymId: string): Promise<ServicePaymentRequest | null> {
    const doc = await ServicePaymentRequestModel.findOne({ _id: id, gymId: new Types.ObjectId(gymId) });
    return doc ? this.toDomain(doc) : null;
  }

  async update(id: string, gymId: string, data: Partial<ServicePaymentRequest>): Promise<ServicePaymentRequest | null> {
    const updateData: any = {};
    if (data.mercadoPagoPaymentLinkId !== undefined) updateData.mercadoPagoPaymentLinkId = data.mercadoPagoPaymentLinkId;
    if (data.initPoint !== undefined) updateData.initPoint = data.initPoint;
    if (data.estado !== undefined) updateData.estado = data.estado;
    const doc = await ServicePaymentRequestModel.findOneAndUpdate(
      { _id: id, gymId: new Types.ObjectId(gymId) },
      updateData,
      { new: true }
    );
    return doc ? this.toDomain(doc) : null;
  }

  async search(gymId: string, filters: { clientId?: string; estado?: string }, page = 1, limit = 20): Promise<any> {
    const query: any = { gymId: new Types.ObjectId(gymId) };
    if (filters.clientId) query.clientId = new Types.ObjectId(filters.clientId);
    if (filters.estado) query.estado = filters.estado;
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      ServicePaymentRequestModel.find(query).sort({ creadoEn: -1 }).skip(skip).limit(limit),
      ServicePaymentRequestModel.countDocuments(query),
    ]);
    return {
      data: docs.map((d: any) => this.toDomain(d)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private toDomain(doc: any): ServicePaymentRequest {
    return {
      id: doc._id.toString(),
      gymId: doc.gymId.toString(),
      clientId: doc.clientId.toString(),
      servicioId: doc.servicioId,
      tipo: doc.tipo,
      referencia: doc.referencia,
      monto: doc.monto,
      estado: doc.estado,
      mercadoPagoPaymentLinkId: doc.mercadoPagoPaymentLinkId,
      initPoint: doc.initPoint,
      creadoEn: doc.creadoEn ?? doc.createdAt,
      actualizadoEn: doc.actualizadoEn ?? doc.updatedAt,
    };
  }
}

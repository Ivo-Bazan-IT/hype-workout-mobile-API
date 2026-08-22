import { Types, FilterQuery } from 'mongoose';
import {
  IRenewalRequestRepository
} from '../../../../domain/repositories/IRenewalRequestRepository';
import {
  RenewalRequest,
  RenewalRequestMapper,
  RenewalRequestStatus,
  CreateRenewalRequestInput
} from '../../../../domain/entities/RenewalRequest';
import { PaginatedResult } from '../../../../domain/repositories/IClientRepository';
import { RenewalRequestModel, RenewalRequestDbDocument } from '../schemas/RenewalRequestSchema';

export class MongoRenewalRequestRepository implements IRenewalRequestRepository {
  async create(request: CreateRenewalRequestInput): Promise<RenewalRequest> {
    const doc = await RenewalRequestModel.create({
      gymId: new Types.ObjectId(request.gymId),
      clientId: new Types.ObjectId(request.clientId),
      plan: request.plan,
      externalReference: request.externalReference,
      mercadoPagoPaymentLinkId: request.mercadoPagoPaymentLinkId,
      initPoint: request.initPoint,
      mercadoPagoPaymentId: request.mercadoPagoPaymentId,
      estado: request.estado ?? 'pendiente',
      fechaVencimientoAnterior: request.fechaVencimientoAnterior,
      fechaVencimientoNueva: request.fechaVencimientoNueva
    });

    return RenewalRequestMapper.toDomain(doc);
  }

  async findById(id: string, gymId: string): Promise<RenewalRequest | null> {
    const doc = await RenewalRequestModel.findOne({ _id: id, gymId });
    return doc ? RenewalRequestMapper.toDomain(doc) : null;
  }

  async findByExternalReference(externalReference: string): Promise<RenewalRequest | null> {
    const doc = await RenewalRequestModel.findOne({ externalReference });
    return doc ? RenewalRequestMapper.toDomain(doc) : null;
  }

  async findPendienteByClientId(clientId: string, gymId: string): Promise<RenewalRequest | null> {
    const doc = await RenewalRequestModel.findOne({
      clientId: new Types.ObjectId(clientId),
      gymId: new Types.ObjectId(gymId),
      estado: 'pendiente'
    }).sort({ createdAt: -1 });

    return doc ? RenewalRequestMapper.toDomain(doc) : null;
  }

  async search(
    gymId: string,
    filters: { clientId?: string; estado?: RenewalRequestStatus },
    page = 1,
    limit = 20
  ): Promise<PaginatedResult<RenewalRequest>> {
    const query: FilterQuery<RenewalRequestDbDocument> = { gymId: new Types.ObjectId(gymId) };

    if (filters.clientId) {
      query.clientId = new Types.ObjectId(filters.clientId);
    }
    if (filters.estado) {
      query.estado = filters.estado;
    }

    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      RenewalRequestModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      RenewalRequestModel.countDocuments(query)
    ]);

    return {
      data: docs.map(RenewalRequestMapper.toDomain),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  async update(id: string, gymId: string, data: Partial<RenewalRequest>): Promise<RenewalRequest | null> {
    // Allowlist explícito, mismo motivo que en `MongoInvoiceRepository`: el plan y
    // el vencimiento anterior son snapshots del momento de crear el pedido y no se
    // editan después.
    const updateData: Partial<RenewalRequestDbDocument> = {};

    if (data.estado !== undefined) updateData.estado = data.estado;
    if (data.mercadoPagoPaymentLinkId !== undefined) updateData.mercadoPagoPaymentLinkId = data.mercadoPagoPaymentLinkId;
    if (data.initPoint !== undefined) updateData.initPoint = data.initPoint;
    if (data.mercadoPagoPaymentId !== undefined) updateData.mercadoPagoPaymentId = data.mercadoPagoPaymentId;
    if (data.resueltoEn !== undefined) updateData.resueltoEn = data.resueltoEn;

    const doc = await RenewalRequestModel.findOneAndUpdate({ _id: id, gymId }, updateData, { new: true });
    return doc ? RenewalRequestMapper.toDomain(doc) : null;
  }
}

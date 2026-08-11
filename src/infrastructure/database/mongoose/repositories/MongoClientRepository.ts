import { ClientModel, ClientDocument } from '../schemas/ClientSchema';
import { IClientRepository, ClientSearchFilters, PaginatedResult } from '../../../../domain/repositories/IClientRepository';
import { Client } from '../../../../domain/entities/Client';
import { ClientMapper } from '../../../../domain/entities/Client';

export class MongoClientRepository implements IClientRepository {
  async create(client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'esRecurrente' | 'historialRenovaciones'>): Promise<Client> {
    const doc = await ClientModel.create({
      gymId: client.gymId,
      nombre: client.nombre,
      documento: client.documento,
      telefono: client.telefono,
      email: client.email,
      estado: client.estado,
      fechaInicio: client.fechaInicio,
      fechaVencimiento: client.fechaVencimiento,
      encuestaData: client.encuestaData,
      fechaConversion: client.fechaConversion,
      fechaPrimerContacto: client.fechaPrimerContacto,
    });
    return ClientMapper.toDomain(doc);
  }

  async findById(id: string, gymId: string): Promise<Client | null> {
    const doc = await ClientModel.findOne({ _id: id, gymId });
    return doc ? ClientMapper.toDomain(doc) : null;
  }

  async findByDocumento(documento: string, gymId: string): Promise<Client | null> {
    const doc = await ClientModel.findOne({ documento, gymId });
    return doc ? ClientMapper.toDomain(doc) : null;
  }

  async search(
    gymId: string,
    filters: ClientSearchFilters,
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResult<Client>> {
    const skip = (page - 1) * limit;
    const query = this.buildQuery(gymId, filters);

    const [docs, total] = await Promise.all([
      ClientModel.find(query).skip(skip).limit(limit).sort({ createdAt: -1 }),
      ClientModel.countDocuments(query)
    ]);

    return {
      data: docs.map(ClientMapper.toDomain),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  async count(gymId: string, filters: ClientSearchFilters): Promise<number> {
    return ClientModel.countDocuments(this.buildQuery(gymId, filters));
  }

  private buildQuery(gymId: string, filters: ClientSearchFilters): Record<string, unknown> {
    const query: Record<string, unknown> = { gymId };

    if (filters.query) {
      // Búsqueda por nombre (texto) o documento (regex con prefijo)
      query.$or = [
        { nombre: { $regex: filters.query, $options: 'i' } },
        { documento: { $regex: `^${filters.query}`, $options: 'i' } }
      ];
    }

    if (filters.estado) {
      query.estado = filters.estado;
    }

    if (filters.esRecurrente !== undefined) {
      query.esRecurrente = filters.esRecurrente;
    }

    // Rango semiabierto sobre el vencimiento vigente, como el resto de los rangos de
    // la API: incluye `desde`, excluye `hasta`. De acá sale el conteo de socios con
    // la cuota al día del dashboard.
    if (filters.vencimientoDesde !== undefined || filters.vencimientoHasta !== undefined) {
      const rango: Record<string, Date> = {};

      if (filters.vencimientoDesde !== undefined) {
        rango.$gte = filters.vencimientoDesde;
      }
      if (filters.vencimientoHasta !== undefined) {
        rango.$lt = filters.vencimientoHasta;
      }

      query.fechaVencimiento = rango;
    }

    return query;
  }

  async update(id: string, gymId: string, data: Partial<Client>): Promise<Client | null> {
    const updateData: Partial<ClientDocument> = {};

    if (data.nombre !== undefined) updateData.nombre = data.nombre;
    if (data.documento !== undefined) updateData.documento = data.documento;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.telefono !== undefined) updateData.telefono = data.telefono;
    if (data.estado !== undefined) updateData.estado = data.estado;
    if (data.fechaInicio !== undefined) updateData.fechaInicio = data.fechaInicio;
    if (data.fechaVencimiento !== undefined) updateData.fechaVencimiento = data.fechaVencimiento;
    if (data.esRecurrente !== undefined) updateData.esRecurrente = data.esRecurrente;
    if (data.historialRenovaciones !== undefined) updateData.historialRenovaciones = data.historialRenovaciones;
    if (data.encuestaData !== undefined) updateData.encuestaData = data.encuestaData;
    if (data.fechaConversion !== undefined) updateData.fechaConversion = data.fechaConversion;
    if (data.fechaPrimerContacto !== undefined)
      updateData.fechaPrimerContacto = data.fechaPrimerContacto;

    const doc = await ClientModel.findOneAndUpdate(
      { _id: id, gymId },
      updateData,
      { new: true }
    );
    return doc ? ClientMapper.toDomain(doc) : null;
  }

  async delete(id: string, gymId: string): Promise<boolean> {
    // Soft delete - cambiar estado a 'inactivo'
    const doc = await ClientModel.findOneAndUpdate(
      { _id: id, gymId },
      { estado: 'inactivo' }
    );
    return !!doc;
  }

  async getExpiringSoon(gymId: string, days: number): Promise<Client[]> {
    const target = new Date();
    target.setDate(target.getDate() + days);
    const startOfDay = new Date(target.setHours(0, 0, 0, 0));
    const endOfDay = new Date(target.setHours(23, 59, 59, 999));

    const docs = await ClientModel.find({
      gymId,
      fechaVencimiento: { $gte: startOfDay, $lte: endOfDay },
      estado: { $ne: 'inactivo' }
    });
    return docs.map(ClientMapper.toDomain);
  }
}
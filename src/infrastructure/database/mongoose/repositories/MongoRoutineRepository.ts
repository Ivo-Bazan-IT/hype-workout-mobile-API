import { Types } from 'mongoose';
import { RoutineModel, RoutineDocument } from '../schemas/RoutineSchema';
import {
  IRoutineRepository,
  RoutineListItem,
  RoutineSearchFilters,
} from '../../../../domain/repositories/IRoutineRepository';
import { PaginatedResult } from '../../../../domain/repositories/IClientRepository';
import { Routine, RoutineSendStatus } from '../../../../domain/entities/Routine';
import { RoutineMapper } from '../../../../domain/entities/Routine';

/** Lo que devuelve el pipeline de `search`: la rutina más el nombre resuelto. */
interface RoutineConCliente {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  promptUsado?: string;
  contenidoGenerado?: Record<string, any>;
  pdfUrl?: string;
  estadoGeneracion: RoutineDocument['estadoGeneracion'];
  estadoEnvio: RoutineDocument['estadoEnvio'];
  whatsappMessageId?: string;
  fechaGeneracion?: Date;
  fechaVencimiento: Date;
  createdAt: Date;
  updatedAt: Date;
  clientNombre?: string;
}

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

  async search(
    gymId: string,
    filters: RoutineSearchFilters,
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResult<RoutineListItem>> {
    const skip = (page - 1) * limit;

    // OJO: los ids van como ObjectId y no como string. `find()` los castea solo a
    // partir del schema, pero `aggregate()` NO —el pipeline es opaco para Mongoose—,
    // así que un string acá no matchea nada y la respuesta vuelve vacía sin error.
    const query: Record<string, unknown> = { gymId: new Types.ObjectId(gymId) };

    if (filters.clientId) {
      query.clientId = new Types.ObjectId(filters.clientId);
    }

    if (filters.estadoEnvio) {
      query.estadoEnvio = filters.estadoEnvio;
    }

    if (filters.estadoGeneracion) {
      query.estadoGeneracion = filters.estadoGeneracion;
    }

    // Semiabierto [desde, hasta), como el resto de los rangos de la API.
    if (filters.vencimientoDesde || filters.vencimientoHasta) {
      const rango: Record<string, Date> = {};
      if (filters.vencimientoDesde) rango.$gte = filters.vencimientoDesde;
      if (filters.vencimientoHasta) rango.$lt = filters.vencimientoHasta;
      query.fechaVencimiento = rango;
    }

    const [docs, total] = await Promise.all([
      RoutineModel.aggregate<RoutineConCliente>([
        { $match: query },
        // Más reciente primero: la rutina que se acaba de generar es la que se mira.
        { $sort: { createdAt: -1 } },
        // El lookup va DESPUÉS de paginar: resuelve los nombres de las 20 filas de la
        // página y no los de todo el historial del gimnasio.
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: 'clients',
            localField: 'clientId',
            foreignField: '_id',
            as: 'cliente',
          },
        },
        {
          $project: {
            gymId: 1,
            clientId: 1,
            promptUsado: 1,
            contenidoGenerado: 1,
            pdfUrl: 1,
            estadoGeneracion: 1,
            estadoEnvio: 1,
            whatsappMessageId: 1,
            fechaGeneracion: 1,
            fechaVencimiento: 1,
            createdAt: 1,
            updatedAt: 1,
            // `$arrayElemAt` sobre el array vacío devuelve `undefined`, que es
            // exactamente el caso del socio borrado.
            clientNombre: { $arrayElemAt: ['$cliente.nombre', 0] },
          },
        },
      ]),
      RoutineModel.countDocuments(query),
    ]);

    return {
      data: docs.map((doc) => ({
        ...RoutineMapper.toDomain(doc),
        clientNombre: doc.clientNombre ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
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

  async countExpiringWithin(gymId: string, days: number): Promise<number> {
    // Ventana completa: del arranque de hoy al cierre del día `days`-ésimo. Las dos
    // puntas se construyen sobre fechas propias porque `setHours` MUTA y devuelve un
    // número, así que reusar una sola instancia para las dos pisa la primera.
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);

    const hasta = new Date();
    hasta.setDate(hasta.getDate() + days);
    hasta.setHours(23, 59, 59, 999);

    return RoutineModel.countDocuments({
      gymId,
      fechaVencimiento: { $gte: desde, $lte: hasta },
    });
  }

  async countBySendStatus(gymId: string, estadoEnvio: RoutineSendStatus): Promise<number> {
    return RoutineModel.countDocuments({ gymId, estadoEnvio });
  }

  async delete(id: string, gymId: string): Promise<boolean> {
    const result = await RoutineModel.deleteOne({ _id: id, gymId });
    return result.deletedCount > 0;
  }
}
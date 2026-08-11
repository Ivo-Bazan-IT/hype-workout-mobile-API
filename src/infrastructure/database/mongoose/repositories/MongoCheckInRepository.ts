import { Types } from 'mongoose';
import {
  ICheckInRepository,
  CheckInListItem,
  CheckInSearchFilters,
  HeatmapCell,
} from '../../../../domain/repositories/ICheckInRepository';
import { PaginatedResult } from '../../../../domain/repositories/IClientRepository';
import { DateRange } from '../../../../domain/kpis/types';
import { CheckIn, CheckInMapper } from '../../../../domain/entities/CheckIn';
import { CheckInModel } from '../schemas/CheckInSchema';

/** Lo que devuelve el pipeline de `search`: el check-in más el nombre resuelto. */
interface CheckInConCliente {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  fecha: Date;
  createdAt: Date;
  updatedAt: Date;
  clientNombre?: string;
}

export class MongoCheckInRepository implements ICheckInRepository {
  async create(checkIn: Omit<CheckIn, 'id' | 'createdAt' | 'updatedAt'>): Promise<CheckIn> {
    const doc = await CheckInModel.create({
      gymId: new Types.ObjectId(checkIn.gymId),
      clientId: new Types.ObjectId(checkIn.clientId),
      fecha: checkIn.fecha,
    });

    return CheckInMapper.toDomain(doc);
  }

  async findByClientAndDay(
    clientId: string,
    gymId: string,
    dia: DateRange
  ): Promise<CheckIn | null> {
    const doc = await CheckInModel.findOne({
      clientId,
      gymId,
      // Semiabierto [start, end), igual que el resto de los rangos del dominio. El
      // rango ya viene cortado en la zona horaria del gimnasio: acá no se decide
      // qué día es un instante.
      fecha: { $gte: dia.start, $lt: dia.end },
    });

    return doc ? CheckInMapper.toDomain(doc) : null;
  }

  async search(
    gymId: string,
    filters: CheckInSearchFilters,
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResult<CheckInListItem>> {
    const skip = (page - 1) * limit;

    // OJO: los ids van como ObjectId y no como string. `find()` los castea solo a
    // partir del schema, pero `aggregate()` NO —el pipeline es opaco para Mongoose—,
    // así que un string acá no matchea nada y la respuesta vuelve vacía sin error.
    const query: Record<string, unknown> = { gymId: new Types.ObjectId(gymId) };

    if (filters.clientId) {
      query.clientId = new Types.ObjectId(filters.clientId);
    }

    if (filters.desde || filters.hasta) {
      const rango: Record<string, Date> = {};
      if (filters.desde) rango.$gte = filters.desde;
      if (filters.hasta) rango.$lte = filters.hasta;
      query.fecha = rango;
    }

    const [docs, total] = await Promise.all([
      CheckInModel.aggregate<CheckInConCliente>([
        { $match: query },
        // Más reciente primero: el historial se lee de arriba hacia abajo.
        { $sort: { fecha: -1 } },
        // El lookup va DESPUÉS de paginar: así resuelve los nombres de las 20 filas
        // de la página y no los de las diez mil del historial completo.
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
            fecha: 1,
            createdAt: 1,
            updatedAt: 1,
            // `$arrayElemAt` sobre el array vacío devuelve `undefined`, que es
            // exactamente el caso del socio borrado.
            clientNombre: { $arrayElemAt: ['$cliente.nombre', 0] },
          },
        },
      ]),
      CheckInModel.countDocuments(query),
    ]);

    return {
      data: docs.map((doc) => ({
        ...CheckInMapper.toDomain(doc),
        clientNombre: doc.clientNombre ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getHeatmap(
    gymId: string,
    range: DateRange,
    timezone: string
  ): Promise<HeatmapCell[]> {
    const celdas = await CheckInModel.aggregate<{
      _id: { dia: number; hora: number };
      total: number;
    }>([
      {
        $match: {
          gymId: new Types.ObjectId(gymId),
          // Semiabierto [start, end), igual que el resto de los rangos del dominio.
          fecha: { $gte: range.start, $lt: range.end },
        },
      },
      {
        $group: {
          _id: {
            // `$isoDayOfWeek` y NO `$dayOfWeek`: el primero devuelve 1 = lunes … 7 =
            // domingo, que es la numeración ISO del contrato. `$dayOfWeek` arranca en
            // domingo y el mapa entero sale corrido un día.
            dia: { $isoDayOfWeek: { date: '$fecha', timezone } },
            // La hora de pared del gimnasio. Mongo resuelve la zona IANA —incluido el
            // horario de verano— contra su propia base: agrupar en UTC y corregir
            // después en Node sería reimplementar eso peor.
            hora: { $hour: { date: '$fecha', timezone } },
          },
          total: { $sum: 1 },
        },
      },
      // Orden estable para que la respuesta no dependa del plan de ejecución.
      { $sort: { '_id.dia': 1, '_id.hora': 1 } },
    ]);

    return celdas.map((c) => ({
      dia: c._id.dia,
      hora: c._id.hora,
      total: c.total,
    }));
  }
}

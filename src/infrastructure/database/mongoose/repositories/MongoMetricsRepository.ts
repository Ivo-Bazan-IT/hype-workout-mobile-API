import { Types } from 'mongoose';
import {
  IMetricsRepository,
  ClientMembershipHistory,
  MemberLastCheckIn,
  MembershipPayment,
  PaidMembershipWindow,
} from '../../../../domain/repositories/IMetricsRepository';
import { LeadRecord } from '../../../../domain/kpis/funnel';
import { tieneEncuestaCompleta } from '../../../../domain/entities/Client';
import { Cents, DateRange } from '../../../../domain/kpis/types';
import { MembershipEventModel } from '../schemas/MembershipEventSchema';
import { CheckInModel } from '../schemas/CheckInSchema';
import { ClientModel } from '../schemas/ClientSchema';

interface EventoAgrupado {
  fecha: Date;
  monto?: number;
  vencimientoNuevo?: Date;
}

interface HistorialAgrupado {
  _id: Types.ObjectId;
  eventos: EventoAgrupado[];
  nombre?: string;
}

/** Los montos se guardan en pesos y los KPIs razonan en centavos enteros. */
const aCentavos = (pesos: number): Cents => Math.round(pesos * 100);

export class MongoMetricsRepository implements IMetricsRepository {
  async getMembershipHistories(gymId: string): Promise<ClientMembershipHistory[]> {
    const historiales = await MembershipEventModel.aggregate<HistorialAgrupado>([
      { $match: { gymId: new Types.ObjectId(gymId) } },
      { $sort: { fecha: 1 } },
      {
        $group: {
          _id: '$clientId',
          eventos: {
            $push: {
              fecha: '$fecha',
              monto: '$monto',
              vencimientoNuevo: '$vencimientoNuevo',
            },
          },
        },
      },
      // El socio eliminado (soft delete) no es una baja de negocio: se excluye acá
      // para que no aparezca como churn. Se agrupa ANTES del lookup para resolver
      // un documento por socio y no uno por evento.
      {
        $lookup: {
          from: 'clients',
          localField: '_id',
          foreignField: '_id',
          as: 'cliente',
        },
      },
      { $match: { cliente: { $ne: [] }, 'cliente.estado': { $ne: 'inactivo' } } },
      // El nombre sale del lookup que ya estaba: es lo que convierte la lista de
      // socios en riesgo en algo accionable. Una lista de ObjectIds no se puede
      // llamar por teléfono.
      { $project: { eventos: 1, nombre: { $arrayElemAt: ['$cliente.nombre', 0] } } },
    ]);

    return historiales.map((h) => this.aHistorial(h));
  }

  async getDataCutoff(gymId: string): Promise<Date | null> {
    const filtroGym = { gymId: new Types.ObjectId(gymId) };

    // Si el gym fue sembrado, el stream recién es completo desde el instante de la
    // siembra: las renovaciones anteriores se cargaron sin su vencimiento.
    const ultimoSembrado = await MembershipEventModel.findOne({
      ...filtroGym,
      origen: 'historico',
    })
      .sort({ createdAt: -1 })
      .select('createdAt');

    if (ultimoSembrado) {
      return ultimoSembrado.createdAt;
    }

    // Gym sin siembra: todo lo que hay se registró en el momento, así que el stream
    // es completo desde su primer evento.
    const primerEvento = await MembershipEventModel.findOne(filtroGym)
      .sort({ fecha: 1 })
      .select('fecha');

    return primerEvento ? primerEvento.fecha : null;
  }

  async countCheckIns(gymId: string, range: DateRange): Promise<number> {
    return CheckInModel.countDocuments({
      gymId: new Types.ObjectId(gymId),
      // Semiabierto [start, end), igual que el resto de los rangos del dominio.
      fecha: { $gte: range.start, $lt: range.end },
    });
  }

  async getLastCheckInByClient(gymId: string): Promise<MemberLastCheckIn[]> {
    const ultimas = await CheckInModel.aggregate<{ _id: Types.ObjectId; ultima: Date }>([
      { $match: { gymId: new Types.ObjectId(gymId) } },
      { $group: { _id: '$clientId', ultima: { $max: '$fecha' } } },
    ]);

    return ultimas.map((u) => ({
      clientId: u._id.toString(),
      lastCheckInAt: u.ultima,
    }));
  }

  async getFirstCheckInDate(gymId: string): Promise<Date | null> {
    const primera = await CheckInModel.findOne({ gymId: new Types.ObjectId(gymId) })
      .sort({ fecha: 1 })
      .select('fecha');

    return primera ? primera.fecha : null;
  }

  async getLeadCohort(gymId: string, range: DateRange): Promise<LeadRecord[]> {
    const docs = await ClientModel.find({
      gymId: new Types.ObjectId(gymId),
      // El soft delete no es un lead perdido: es un alta cargada por error.
      estado: { $ne: 'inactivo' },
      // Semiabierto [start, end), igual que el resto de los rangos del dominio.
      createdAt: { $gte: range.start, $lt: range.end },
    }).select('createdAt fechaPrimerContacto fechaConversion encuestaData');

    return docs.map((doc) => ({
      clientId: doc._id.toString(),
      createdAt: doc.createdAt,
      // El dominio razona con `null`; Mongoose devuelve `undefined` para el campo
      // ausente. Se normaliza acá para que la frontera quede de un solo tipo.
      fechaPrimerContacto: doc.fechaPrimerContacto ?? null,
      fechaConversion: doc.fechaConversion ?? null,
      // Contestar la encuesta ES la conversión, tenga fecha o no. Los clientes
      // anteriores a la tanda 4 entran por acá: convertidos, sin fecha.
      convertido: tieneEncuestaCompleta(doc.encuestaData),
    }));
  }

  async countConversions(gymId: string, range: DateRange): Promise<number> {
    return ClientModel.countDocuments({
      gymId: new Types.ObjectId(gymId),
      estado: { $ne: 'inactivo' },
      fechaConversion: { $gte: range.start, $lt: range.end },
    });
  }

  private aHistorial(agrupado: HistorialAgrupado): ClientMembershipHistory {
    const windows: PaidMembershipWindow[] = [];
    const pagos: MembershipPayment[] = [];

    for (const evento of agrupado.eventos) {
      if (evento.monto !== undefined && evento.monto !== null) {
        pagos.push({ fecha: evento.fecha, monto: aCentavos(evento.monto) });
      }

      // Sin vencimiento no hay ventana: es una renovación histórica de la que se
      // conoce el cobro pero no hasta cuándo extendió la membresía.
      if (evento.vencimientoNuevo) {
        windows.push({
          inicio: evento.fecha,
          vencimiento: evento.vencimientoNuevo,
          monto:
            evento.monto !== undefined && evento.monto !== null
              ? aCentavos(evento.monto)
              : null,
        });
      }
    }

    return {
      clientId: agrupado._id.toString(),
      nombre: agrupado.nombre ?? null,
      // Los eventos vienen ordenados por fecha desde el pipeline.
      fechaAlta: agrupado.eventos[0].fecha,
      windows,
      pagos,
    };
  }
}

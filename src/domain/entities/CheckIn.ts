import { Types } from 'mongoose';

/**
 * Asistencia de un socio al gimnasio.
 *
 * Es el segundo stream crudo del CRM, después de los eventos de membresía, y el que
 * habilita los indicadores ADELANTADOS de churn: el churn dice a quién ya se perdió,
 * la asistencia dice a quién se está por perder. Quien va 2+ veces por semana tiene
 * la mitad de probabilidad de darse de baja que quien va una vez o menos.
 *
 * Deliberadamente mínima: quién, dónde y cuándo. Todo lo demás —frecuencia, socios
 * fantasma, franjas pico— se deriva; nada de eso se guarda.
 */
export interface CheckIn {
  id: string;
  gymId: string;
  clientId: string;
  /** Momento del ingreso. Se registra completo: la hora es lo que permite leer las franjas pico. */
  fecha: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class CheckInEntity implements CheckIn {
  constructor(
    public id: string,
    public gymId: string,
    public clientId: string,
    public fecha: Date = new Date(),
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class CheckInMapper {
  static toDomain(doc: any): CheckIn {
    return new CheckInEntity(
      doc._id.toString(),
      doc.gymId.toString(),
      doc.clientId.toString(),
      doc.fecha,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: CheckInEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      clientId: new Types.ObjectId(entity.clientId),
      fecha: entity.fecha,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

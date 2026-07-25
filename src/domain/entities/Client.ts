import { Types } from 'mongoose';

export type ClientStatus = 'activo' | 'inactivo' | 'pendiente';

export interface RenewalHistory {
  fecha: Date;
  monto: number;
}

export interface Client {
  id: string;
  gymId: string;
  nombre: string;
  documento: string;
  // Opcional: un cliente puede darse de alta solo con nombre y documento, y
  // completarse después con la encuesta (PATCH /api/clients/:id/encuesta).
  telefono?: string;
  email?: string;
  estado: ClientStatus;
  fechaInicio: Date;
  fechaVencimiento: Date;
  esRecurrente: boolean;
  historialRenovaciones: RenewalHistory[];
  encuestaData?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export class ClientEntity implements Client {
  constructor(
    public id: string,
    public gymId: string,
    public nombre: string,
    public documento: string,
    public telefono: string | undefined,
    public estado: ClientStatus = 'pendiente',
    public fechaInicio: Date = new Date(),
    public fechaVencimiento: Date = new Date(),
    public esRecurrente: boolean = false,
    public historialRenovaciones: RenewalHistory[] = [],
    public email?: string,
    public encuestaData?: Record<string, any>,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class ClientMapper {
  static toDomain(doc: any): Client {
    return new ClientEntity(
      doc._id.toString(),
      doc.gymId.toString(),
      doc.nombre,
      doc.documento,
      doc.telefono,
      doc.estado,
      doc.fechaInicio,
      doc.fechaVencimiento,
      doc.esRecurrente,
      doc.historialRenovaciones,
      doc.email,
      doc.encuestaData,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: ClientEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      nombre: entity.nombre,
      documento: entity.documento,
      telefono: entity.telefono,
      email: entity.email,
      estado: entity.estado,
      fechaInicio: entity.fechaInicio,
      fechaVencimiento: entity.fechaVencimiento,
      esRecurrente: entity.esRecurrente,
      historialRenovaciones: entity.historialRenovaciones,
      encuestaData: entity.encuestaData,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
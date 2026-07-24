import { Types } from 'mongoose';

export type RoutineGenerationStatus = 'pendiente' | 'generando' | 'generado' | 'error';
export type RoutineSendStatus = 'pendiente' | 'enviando' | 'enviado' | 'error';

export interface Routine {
  id: string;
  gymId: string;
  clientId: string;
  promptUsado?: string;
  contenidoGenerado?: Record<string, any>;
  pdfUrl?: string;
  estadoGeneracion: RoutineGenerationStatus;
  estadoEnvio: RoutineSendStatus;
  whatsappMessageId?: string;
  fechaGeneracion?: Date;
  fechaVencimiento: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class RoutineEntity implements Routine {
  constructor(
    public id: string,
    public gymId: string,
    public clientId: string,
    public estadoGeneracion: RoutineGenerationStatus = 'pendiente',
    public estadoEnvio: RoutineSendStatus = 'pendiente',
    public fechaVencimiento: Date = new Date(),
    public promptUsado?: string,
    public contenidoGenerado?: Record<string, any>,
    public pdfUrl?: string,
    public whatsappMessageId?: string,
    public fechaGeneracion?: Date,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class RoutineMapper {
  static toDomain(doc: any): Routine {
    return new RoutineEntity(
      doc._id.toString(),
      doc.gymId.toString(),
      doc.clientId.toString(),
      doc.estadoGeneracion,
      doc.estadoEnvio,
      doc.fechaVencimiento,
      doc.promptUsado,
      doc.contenidoGenerado,
      doc.pdfUrl,
      doc.whatsappMessageId,
      doc.fechaGeneracion,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: RoutineEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      clientId: new Types.ObjectId(entity.clientId),
      promptUsado: entity.promptUsado,
      contenidoGenerado: entity.contenidoGenerado,
      pdfUrl: entity.pdfUrl,
      estadoGeneracion: entity.estadoGeneracion,
      estadoEnvio: entity.estadoEnvio,
      whatsappMessageId: entity.whatsappMessageId,
      fechaGeneracion: entity.fechaGeneracion,
      fechaVencimiento: entity.fechaVencimiento,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
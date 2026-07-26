import { Types } from 'mongoose';
import { AiProvider } from './Gym';
import { FuenteCredencialIA } from '../ai/credentials';

/**
 * Consumo de IA de una generación de rutina, atribuido a un gym.
 *
 * Es la unidad de medición que permite responder "cuánto gastó este gym este mes":
 * hasta ahora el `usage` que devolvían los SDKs se descartaba y no había forma de
 * atribuir el costo a ningún tenant.
 */
export interface AiUsageRecord {
  id: string;
  gymId: string;
  clientId: string;
  routineId: string;
  provider: AiProvider;
  /** Modelo realmente usado, no el pedido (puede ser el default del adaptador) */
  model: string;
  tokensPrompt: number;
  tokensRespuesta: number;
  tokensTotal: number;
  /** USD estimados. `null` si el modelo no tiene precio cargado en domain/ai/pricing */
  costoEstimado: number | null;
  /**
   * Con qué credencial se generó. Permite separar lo que paga el gym (`gym`) de
   * lo que paga la plataforma (`plataforma`, `respaldo`) al tarifar.
   * `null` en los registros anteriores a que se midiera esto.
   */
  fuenteCredencial: FuenteCredencialIA | null;
  createdAt: Date;
  updatedAt: Date;
}

export class AiUsageRecordEntity implements AiUsageRecord {
  constructor(
    public id: string,
    public gymId: string,
    public clientId: string,
    public routineId: string,
    public provider: AiProvider,
    public model: string,
    public tokensPrompt: number = 0,
    public tokensRespuesta: number = 0,
    public tokensTotal: number = 0,
    public costoEstimado: number | null = null,
    public fuenteCredencial: FuenteCredencialIA | null = null,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class AiUsageRecordMapper {
  static toDomain(doc: any): AiUsageRecord {
    return new AiUsageRecordEntity(
      doc._id.toString(),
      doc.gymId.toString(),
      doc.clientId.toString(),
      doc.routineId.toString(),
      doc.provider,
      doc.model,
      doc.tokensPrompt,
      doc.tokensRespuesta,
      doc.tokensTotal,
      doc.costoEstimado ?? null,
      doc.fuenteCredencial ?? null,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: AiUsageRecordEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      clientId: new Types.ObjectId(entity.clientId),
      routineId: new Types.ObjectId(entity.routineId),
      provider: entity.provider,
      model: entity.model,
      tokensPrompt: entity.tokensPrompt,
      tokensRespuesta: entity.tokensRespuesta,
      tokensTotal: entity.tokensTotal,
      costoEstimado: entity.costoEstimado,
      fuenteCredencial: entity.fuenteCredencial,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

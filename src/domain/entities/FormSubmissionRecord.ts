import { Types } from 'mongoose';

/**
 * Registro de una submission ya procesada.
 *
 * Existe para dos cosas distintas que resultaron ser la misma tabla:
 *
 *  1. **Idempotencia.** El Apps Script reintenta ante 5xx y timeouts, y una
 *     respuesta que llegó pero cuya confirmación se perdió se reenvía igual. Sin
 *     esto, cada reintento vuelve a fusionar la encuesta y a recalcular la
 *     conversión. La fusión es idempotente por casualidad, no por diseño — el día
 *     que el webhook haga algo con efecto acumulativo, deja de serlo en silencio.
 *  2. **Estado de la integración.** `GET /api/onboarding/status` sale de acá: sin
 *     un registro de lo recibido, el endpoint no tenía más que un timestamp
 *     inventado que decía "activo" incluso con el trigger desinstalado.
 *
 * Se guarda el resultado y no solo el id: cuando una submission rebota porque el
 * DNI no existe, ese es exactamente el caso que quien administra el gym necesita
 * ver, y perderlo dejaría el problema invisible del lado del CRM.
 */
export type FormSubmissionOutcome = 'procesada' | 'rechazada';

export interface FormSubmissionRecord {
  id: string;
  gymId: string;
  /**
   * Id de la respuesta del lado de Google. Es la clave de idempotencia.
   *
   * Opcional porque no siempre existe: instalado sobre la HOJA de respuestas, el
   * evento de Apps Script no trae el id del `FormResponse`. Sin él la submission se
   * procesa igual —perder el dato es peor que perder la idempotencia— pero no puede
   * deduplicarse.
   */
  responseId?: string;
  /** Documento que traía la submission, aunque no haya matcheado ninguna ficha. */
  documento?: string;
  /** `null` cuando la submission fue rechazada. */
  clientId?: string;
  resultado: FormSubmissionOutcome;
  /** Por qué se rechazó. Vacío en las procesadas. */
  motivo?: string;
  recibidaEn: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class FormSubmissionRecordEntity implements FormSubmissionRecord {
  constructor(
    public id: string,
    public gymId: string,
    public resultado: FormSubmissionOutcome,
    public recibidaEn: Date = new Date(),
    public responseId?: string,
    public documento?: string,
    public clientId?: string,
    public motivo?: string,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class FormSubmissionRecordMapper {
  static toDomain(doc: any): FormSubmissionRecord {
    return new FormSubmissionRecordEntity(
      doc._id.toString(),
      doc.gymId.toString(),
      doc.resultado,
      doc.recibidaEn,
      doc.responseId,
      doc.documento,
      doc.clientId ? doc.clientId.toString() : undefined,
      doc.motivo,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: FormSubmissionRecordEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      responseId: entity.responseId,
      documento: entity.documento,
      clientId: entity.clientId ? new Types.ObjectId(entity.clientId) : undefined,
      resultado: entity.resultado,
      motivo: entity.motivo,
      recibidaEn: entity.recibidaEn,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

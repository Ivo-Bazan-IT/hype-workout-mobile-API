import { Types } from 'mongoose';
import {
  IFormSubmissionRecordRepository,
  FormSubmissionStats,
} from '../../../../domain/repositories/IFormSubmissionRecordRepository';
import {
  FormSubmissionRecord,
  FormSubmissionRecordMapper,
} from '../../../../domain/entities/FormSubmissionRecord';
import { FormSubmissionRecordModel } from '../schemas/FormSubmissionRecordSchema';

export class MongoFormSubmissionRecordRepository
  implements IFormSubmissionRecordRepository
{
  async findByResponseId(
    gymId: string,
    responseId: string
  ): Promise<FormSubmissionRecord | null> {
    const doc = await FormSubmissionRecordModel.findOne({
      gymId: new Types.ObjectId(gymId),
      responseId,
    });

    return doc ? FormSubmissionRecordMapper.toDomain(doc) : null;
  }

  async registrar(
    record: Omit<FormSubmissionRecord, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<FormSubmissionRecord> {
    const datos = {
      gymId: new Types.ObjectId(record.gymId),
      responseId: record.responseId,
      documento: record.documento,
      clientId: record.clientId ? new Types.ObjectId(record.clientId) : undefined,
      resultado: record.resultado,
      motivo: record.motivo,
      recibidaEn: record.recibidaEn,
    };

    // Sin `responseId` no hay con qué deduplicar: cada envío es un registro nuevo.
    if (!record.responseId) {
      const doc = await FormSubmissionRecordModel.create(datos);
      return FormSubmissionRecordMapper.toDomain(doc);
    }

    // `$unset` explícito de los campos ausentes: un `$set` parcial dejaría el
    // `clientId` y el `motivo` de la corrida anterior pegados al registro nuevo, y
    // una submission reprocesada con éxito seguiría mostrando por qué falló.
    const doc = await FormSubmissionRecordModel.findOneAndUpdate(
      { gymId: datos.gymId, responseId: record.responseId },
      {
        $set: {
          documento: record.documento,
          resultado: record.resultado,
          recibidaEn: record.recibidaEn,
          ...(record.clientId && { clientId: datos.clientId }),
          ...(record.motivo && { motivo: record.motivo }),
        },
        $unset: {
          ...(record.clientId ? {} : { clientId: '' }),
          ...(record.motivo ? {} : { motivo: '' }),
        },
      },
      { new: true, upsert: true }
    );

    return FormSubmissionRecordMapper.toDomain(doc);
  }

  async getStats(gymId: string, ultimosRechazos: number): Promise<FormSubmissionStats> {
    const filtro = { gymId: new Types.ObjectId(gymId) };

    const [porResultado, ultima, rechazos] = await Promise.all([
      FormSubmissionRecordModel.aggregate<{ _id: string; total: number }>([
        { $match: filtro },
        { $group: { _id: '$resultado', total: { $sum: 1 } } },
      ]),
      FormSubmissionRecordModel.findOne(filtro).sort({ recibidaEn: -1 }),
      FormSubmissionRecordModel.find({ ...filtro, resultado: 'rechazada' })
        .sort({ recibidaEn: -1 })
        .limit(ultimosRechazos),
    ]);

    const contar = (resultado: string): number =>
      porResultado.find((r) => r._id === resultado)?.total ?? 0;

    const procesadas = contar('procesada');
    const rechazadas = contar('rechazada');

    return {
      total: procesadas + rechazadas,
      procesadas,
      rechazadas,
      ultima: ultima ? FormSubmissionRecordMapper.toDomain(ultima) : null,
      ultimosRechazos: rechazos.map(FormSubmissionRecordMapper.toDomain),
    };
  }
}

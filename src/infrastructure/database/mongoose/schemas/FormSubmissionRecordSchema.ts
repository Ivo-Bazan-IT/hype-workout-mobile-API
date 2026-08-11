import { Schema, model, Types } from 'mongoose';

export interface FormSubmissionRecordDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  responseId?: string;
  documento?: string;
  clientId?: Types.ObjectId;
  resultado: 'procesada' | 'rechazada';
  motivo?: string;
  recibidaEn: Date;
  createdAt: Date;
  updatedAt: Date;
}

const formSubmissionRecordSchema = new Schema<FormSubmissionRecordDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true },
  responseId: { type: String },
  documento: { type: String },
  clientId: { type: Schema.Types.ObjectId, ref: 'Client' },
  resultado: { type: String, enum: ['procesada', 'rechazada'], required: true },
  motivo: { type: String },
  recibidaEn: { type: Date, required: true },
}, { timestamps: true });

// Clave de idempotencia.
//
// Va `partialFilterExpression` y NO `sparse`, que es la trampa de este índice: en un
// índice COMPUESTO, `sparse` excluye el documento solo si le faltan TODOS los campos
// indexados. Como `gymId` siempre está, una submission sin `responseId` igual se
// indexa —con el id en `null`— y la segunda que llegue así choca contra la primera.
// Eso rompe justo el caso que el `sparse` pretendía cubrir: el trigger instalado
// sobre la hoja de respuestas, que no tiene id y manda todas sin él.
formSubmissionRecordSchema.index(
  { gymId: 1, responseId: 1 },
  { unique: true, partialFilterExpression: { responseId: { $exists: true } } }
);

// El estado de la integración se lee siempre por gym y de lo más nuevo a lo más viejo.
formSubmissionRecordSchema.index({ gymId: 1, recibidaEn: -1 });

export const FormSubmissionRecordModel = model<FormSubmissionRecordDocument>(
  'FormSubmissionRecord',
  formSubmissionRecordSchema
);

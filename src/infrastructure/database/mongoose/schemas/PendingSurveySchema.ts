import { Schema, model, Types } from 'mongoose';

export interface PendingSurveyDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  datos: Record<string, any>;
  creadoEn: Date;
  actualizadoEn: Date;
}

const pendingSurveySchema = new Schema<PendingSurveyDocument>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: { unique: true, sparse: true } },
  datos: { type: Schema.Types.Mixed, required: true },
  creadoEn: { type: Date, default: Date.now },
  actualizadoEn: { type: Date, default: Date.now },
}, { timestamps: false });

// TTL opcional: 30 días para no acumular encuestas de gente que nunca elige entrenador
pendingSurveySchema.index({ creadoEn: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const PendingSurveyModel = model<PendingSurveyDocument>('PendingSurvey', pendingSurveySchema);

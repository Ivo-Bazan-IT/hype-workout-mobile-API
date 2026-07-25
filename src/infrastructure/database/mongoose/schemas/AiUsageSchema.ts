import { Schema, model, Types } from 'mongoose';

export interface AiUsageDbDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  routineId: Types.ObjectId;
  provider: 'deepseek' | 'openai' | 'anthropic';
  model: string;
  tokensPrompt: number;
  tokensRespuesta: number;
  tokensTotal: number;
  costoEstimado?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const aiUsageSchema = new Schema<AiUsageDbDocument>(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    routineId: { type: Schema.Types.ObjectId, ref: 'Routine', required: true },
    provider: { type: String, enum: ['deepseek', 'openai', 'anthropic'], required: true },
    model: { type: String, required: true },
    tokensPrompt: { type: Number, default: 0 },
    tokensRespuesta: { type: Number, default: 0 },
    tokensTotal: { type: Number, default: 0 },
    // null = el modelo no tiene precio cargado. Distinto de 0 ("salió gratis").
    costoEstimado: { type: Number, default: null },
  },
  { timestamps: true }
);

// El reporte siempre filtra por gym + rango de fechas
aiUsageSchema.index({ gymId: 1, createdAt: 1 });
aiUsageSchema.index({ gymId: 1, model: 1 });

export const AiUsageModel = model<AiUsageDbDocument>('AiUsage', aiUsageSchema);

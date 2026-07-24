import { Schema, model, Types } from 'mongoose';

export interface RoutineDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  promptUsado?: string;
  contenidoGenerado?: Record<string, any>;
  pdfUrl?: string;
  estadoGeneracion: 'pendiente' | 'generando' | 'generado' | 'error';
  estadoEnvio: 'pendiente' | 'enviando' | 'enviado' | 'error';
  whatsappMessageId?: string;
  fechaGeneracion?: Date;
  fechaVencimiento: Date;
  createdAt: Date;
  updatedAt: Date;
}

const routineSchema = new Schema<RoutineDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  promptUsado: { type: String },
  contenidoGenerado: { type: Schema.Types.Mixed },
  pdfUrl: { type: String },
  estadoGeneracion: {
    type: String,
    enum: ['pendiente', 'generando', 'generado', 'error'],
    default: 'pendiente'
  },
  estadoEnvio: {
    type: String,
    enum: ['pendiente', 'enviando', 'enviado', 'error'],
    default: 'pendiente'
  },
  whatsappMessageId: { type: String },
  fechaGeneracion: { type: Date },
  fechaVencimiento: { type: Date, required: true },
}, { timestamps: true });

routineSchema.index({ gymId: 1, fechaVencimiento: 1 });
routineSchema.index({ gymId: 1, clientId: 1 });

export const RoutineModel = model<RoutineDocument>('Routine', routineSchema);
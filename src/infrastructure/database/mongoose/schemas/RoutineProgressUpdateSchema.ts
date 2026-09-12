import { Schema, model, Types } from 'mongoose';

export interface RoutineProgressUpdateDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  routineId: Types.ObjectId;
  clientId: Types.ObjectId;
  semana: number;
  datos: Record<string, any>;
  estado: 'pendiente_revision' | 'revisado';
  createdAt: Date;
  updatedAt: Date;
}

const routineProgressUpdateSchema = new Schema<RoutineProgressUpdateDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
  routineId: { type: Schema.Types.ObjectId, ref: 'Routine', required: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  semana: { type: Number, required: true },
  datos: { type: Schema.Types.Mixed, required: true },
  estado: { type: String, enum: ['pendiente_revision', 'revisado'], default: 'pendiente_revision' },
}, { timestamps: true });

routineProgressUpdateSchema.index({ gymId: 1, clientId: 1, semana: 1 }, { unique: true });
routineProgressUpdateSchema.index({ gymId: 1, estado: 1 });

export const RoutineProgressUpdateModel = model<RoutineProgressUpdateDocument>('RoutineProgressUpdate', routineProgressUpdateSchema);

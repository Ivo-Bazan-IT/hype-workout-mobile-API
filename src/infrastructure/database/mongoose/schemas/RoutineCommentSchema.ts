import { Schema, model, Types } from 'mongoose';

export interface RoutineCommentDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  routineId: Types.ObjectId;
  clientId: Types.ObjectId;
  autorUserId: Types.ObjectId;
  autorRol: 'entrenador' | 'cliente';
  texto: string;
  createdAt: Date;
}

const routineCommentSchema = new Schema<RoutineCommentDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
  routineId: { type: Schema.Types.ObjectId, ref: 'Routine', required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  autorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  autorRol: { type: String, enum: ['entrenador', 'cliente'], required: true },
  texto: { type: String, required: true, maxlength: 2000 },
}, { timestamps: { createdAt: true, updatedAt: false } });

routineCommentSchema.index({ gymId: 1, routineId: 1, createdAt: 1 });

export const RoutineCommentModel = model<RoutineCommentDocument>('RoutineComment', routineCommentSchema);

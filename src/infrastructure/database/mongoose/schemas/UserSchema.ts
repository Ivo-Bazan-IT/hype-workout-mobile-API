import { Schema, model, Types } from 'mongoose';

export interface UserDocument {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  role: 'admin' | 'entrenador' | 'cliente';
  gymId?: Types.ObjectId;
  entrenadorId?: Types.ObjectId;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'entrenador', 'cliente'], required: true },
  gymId: {
    type: Schema.Types.ObjectId,
    ref: 'Gym',
    required: false,
  },
  entrenadorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Índices para el listado del super-admin (filtros por gym, rol y estado)
userSchema.index({ gymId: 1 });
userSchema.index({ role: 1, isActive: 1 });

export const UserModel = model<UserDocument>('User', userSchema);
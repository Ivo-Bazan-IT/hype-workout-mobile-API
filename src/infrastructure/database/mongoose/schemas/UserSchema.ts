import { Schema, model, Types } from 'mongoose';

export interface UserDocument {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  role: 'admin' | 'gym';
  gymId?: Types.ObjectId;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'gym'], required: true },
  gymId: {
    type: Schema.Types.ObjectId,
    ref: 'Gym',
    required: function () { return this.role === 'gym'; }
  },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Índices para el listado del super-admin (filtros por gym, rol y estado)
userSchema.index({ gymId: 1 });
userSchema.index({ role: 1, isActive: 1 });

export const UserModel = model<UserDocument>('User', userSchema);
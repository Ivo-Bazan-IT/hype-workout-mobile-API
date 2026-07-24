import { Schema, model, Types } from 'mongoose';

export interface ClientDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  nombre: string;
  documento: string;
  telefono: string;
  email?: string;
  estado: 'activo' | 'inactivo' | 'pendiente';
  fechaInicio: Date;
  fechaVencimiento: Date;
  esRecurrente: boolean;
  historialRenovaciones: { fecha: Date; monto: number }[];
  encuestaData?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const clientSchema = new Schema<ClientDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true },
  nombre: { type: String, required: true },
  documento: { type: String, required: true },
  telefono: { type: String, required: true },
  email: { type: String },
  estado: { type: String, enum: ['activo', 'inactivo', 'pendiente'], default: 'pendiente' },
  fechaInicio: { type: Date, required: true },
  fechaVencimiento: { type: Date, required: true },
  esRecurrente: { type: Boolean, default: false },
  historialRenovaciones: [{ fecha: Date, monto: Number }],
  encuestaData: { type: Schema.Types.Mixed },
}, { timestamps: true });

// Índices clave para el buscador (nombre + documento)
clientSchema.index({ gymId: 1, documento: 1 });
clientSchema.index({ gymId: 1, nombre: 'text' });
clientSchema.index({ gymId: 1, fechaVencimiento: 1 });
clientSchema.index({ gymId: 1, estado: 1 });

export const ClientModel = model<ClientDocument>('Client', clientSchema);
import { Schema, model, Types } from 'mongoose';

export interface CheckInDbDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  fecha: Date;
  createdAt: Date;
  updatedAt: Date;
}

const checkInSchema = new Schema<CheckInDbDocument>(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    fecha: { type: Date, required: true },
  },
  { timestamps: true }
);

// Conteos y rangos del gym: es la consulta de los KPIs de engagement.
checkInSchema.index({ gymId: 1, fecha: 1 });
// Historial de un socio y chequeo de duplicado del día.
checkInSchema.index({ gymId: 1, clientId: 1, fecha: -1 });

export const CheckInModel = model<CheckInDbDocument>('CheckIn', checkInSchema);

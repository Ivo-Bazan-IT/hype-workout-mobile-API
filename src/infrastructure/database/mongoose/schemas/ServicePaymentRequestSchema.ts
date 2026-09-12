import { Schema, model, Types } from 'mongoose';

export interface ServicePaymentRequestDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  servicioId: string;
  tipo: 'servicio';
  referencia: { servicioId: string };
  monto: number;
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'expirado' | 'cancelado';
  linkPago?: string;
  creadoEn: Date;
  actualizadoEn: Date;
}

const servicePaymentRequestSchema = new Schema<ServicePaymentRequestDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  servicioId: { type: String, required: true },
  tipo: { type: String, enum: ['servicio'], default: 'servicio' },
  referencia: { servicioId: { type: String, required: true } },
  monto: { type: Number, required: true },
  estado: { type: String, enum: ['pendiente', 'aprobado', 'rechazado', 'expirado', 'cancelado'], default: 'pendiente' },
  linkPago: { type: String },
}, { timestamps: { createdAt: 'creadoEn', updatedAt: 'actualizadoEn' } });

servicePaymentRequestSchema.index({ gymId: 1, clientId: 1, estado: 1 });

export const ServicePaymentRequestModel = model<ServicePaymentRequestDocument>('ServicePaymentRequest', servicePaymentRequestSchema);

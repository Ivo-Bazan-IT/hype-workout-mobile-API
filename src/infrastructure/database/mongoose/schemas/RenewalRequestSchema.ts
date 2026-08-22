import { Schema, model, Types } from 'mongoose';

export interface RenewalRequestDbDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  plan: {
    tipo: string;
    duracionDias: number;
    monto: number;
  };
  externalReference: string;
  mercadoPagoPaymentLinkId?: string;
  initPoint?: string;
  mercadoPagoPaymentId?: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'expirado' | 'cancelado';
  fechaVencimientoAnterior: Date;
  fechaVencimientoNueva: Date;
  createdAt: Date;
  updatedAt: Date;
  resueltoEn?: Date;
}

const renewalRequestSchema = new Schema<RenewalRequestDbDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },

  plan: {
    tipo: { type: String, required: true },
    duracionDias: { type: Number, required: true },
    monto: { type: Number, required: true },
  },

  // Único a nivel de toda la colección (no solo por gym): es lo que Mercado Pago
  // devuelve en el pago para reconciliar, así que dos pedidos con la misma
  // referencia serían indistinguibles ante un webhook.
  externalReference: { type: String, required: true, unique: true },
  mercadoPagoPaymentLinkId: { type: String },
  initPoint: { type: String },
  mercadoPagoPaymentId: { type: String },

  estado: {
    type: String,
    enum: ['pendiente', 'aprobado', 'rechazado', 'expirado', 'cancelado'],
    default: 'pendiente'
  },

  fechaVencimientoAnterior: { type: Date, required: true },
  fechaVencimientoNueva: { type: Date, required: true },
  resueltoEn: { type: Date },
}, { timestamps: true });

renewalRequestSchema.index({ gymId: 1, clientId: 1, estado: 1 });

export const RenewalRequestModel = model<RenewalRequestDbDocument>('RenewalRequest', renewalRequestSchema);

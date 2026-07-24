import { Schema, model, Types } from 'mongoose';

// Schema interno con ObjectId
export interface InvoiceDbDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  tipoComprobante: string;
  cae: string;
  monto: number;
  fechaEmision: Date;
  estado: 'emitida' | 'anulada' | 'error' | 'pendiente';
  errorLog?: string;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<InvoiceDbDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  tipoComprobante: { type: String, required: true }, // Ej: "Factura C"
  cae: { type: String, required: true },
  fechaEmision: { type: Date, default: Date.now },
  monto: { type: Number, required: true },
  estado: { type: String, enum: ['emitida', 'anulada', 'error', 'pendiente'], default: 'pendiente' },
  errorLog: { type: String }
}, { timestamps: true });

invoiceSchema.index({ gymId: 1, fechaEmision: 1 });
invoiceSchema.index({ gymId: 1, estado: 1 });

export const InvoiceModel = model<InvoiceDbDocument>('Invoice', invoiceSchema);
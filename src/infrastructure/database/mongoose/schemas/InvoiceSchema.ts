import { Schema, model, Types } from 'mongoose';

// Schema interno con ObjectId
export interface InvoiceDbDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  tipoComprobante: string;
  codigoTipoComprobante?: number;
  puntoVenta?: number;
  numeroComprobante?: number;
  cae: string;
  vencimientoCae?: Date;
  monto: number;
  neto?: number;
  iva?: number;
  descripcion?: string;
  fechaEmision: Date;
  estado: 'emitida' | 'anulada' | 'error' | 'pendiente';
  errorLog?: string;
  intentos: number;
  proximoIntento?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<InvoiceDbDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  tipoComprobante: { type: String, required: true }, // Ej: "Factura C"

  // Datos que devuelve AFIP al otorgar el CAE. Ninguno es required porque la
  // factura nace `pendiente`, antes de que exista comprobante: se completan al
  // emitir. La terna (puntoVenta, codigoTipoComprobante, numeroComprobante) es lo
  // que identifica al comprobante ante AFIP; el CAE solo lo autoriza.
  codigoTipoComprobante: { type: Number },
  puntoVenta: { type: Number },
  numeroComprobante: { type: Number },
  // No es required: una factura en estado 'error' no tiene CAE, y Mongoose rechaza
  // la cadena vacía en un campo required. Con `required` el registro del fallo de
  // AFIP explotaba y se llevaba puesta la renovación entera del socio.
  cae: { type: String, default: '' },
  vencimientoCae: { type: Date },

  fechaEmision: { type: Date, default: Date.now },
  monto: { type: Number, required: true },
  neto: { type: Number },
  iva: { type: Number },
  descripcion: { type: String },
  estado: { type: String, enum: ['emitida', 'anulada', 'error', 'pendiente'], default: 'pendiente' },
  errorLog: { type: String },

  intentos: { type: Number, default: 0 },
  /**
   * Sin `default`, a propósito: quién sale de la cola lo decide el repositorio con
   * un `$unset`, y Mongoose vuelve a aplicar los defaults al HIDRATAR un documento
   * al que le falta el campo. Con un default acá, una factura ya emitida se leía
   * con un `proximoIntento` fabricado en el momento, como si siguiera encolada.
   * El valor inicial lo pone el repositorio al crear la factura.
   */
  proximoIntento: { type: Date }
}, { timestamps: true });

invoiceSchema.index({ gymId: 1, fechaEmision: 1 });
invoiceSchema.index({ gymId: 1, estado: 1 });
// Índice de la cola. Es el único sin `gymId` al frente, porque el worker busca
// trabajo pendiente en todos los tenants a la vez y ordena por `proximoIntento`.
invoiceSchema.index({ estado: 1, proximoIntento: 1 });

export const InvoiceModel = model<InvoiceDbDocument>('Invoice', invoiceSchema);

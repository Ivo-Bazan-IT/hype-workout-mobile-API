import { Schema, model, Types } from 'mongoose';
import { CONDICIONES_FISCALES_CLIENTE, ClientTaxCondition } from '../../../../domain/billing/types';

export interface ClientDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  nombre: string;
  documento: string;
  telefono?: string;
  email?: string;
  estado: 'activo' | 'inactivo' | 'pendiente';
  fechaInicio: Date;
  fechaVencimiento: Date;
  esRecurrente: boolean;
  historialRenovaciones: { fecha: Date; monto: number }[];
  encuestaData?: Record<string, any>;
  fechaConversion?: Date;
  fechaPrimerContacto?: Date;
  fechaFormularioEnviado?: Date;
  condicionFiscal?: ClientTaxCondition;
  cuit?: string;
  createdAt: Date;
  updatedAt: Date;
}

const clientSchema = new Schema<ClientDocument>({
  gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true },
  nombre: { type: String, required: true },
  documento: { type: String, required: true },
  // Sin `required`: se completa con la encuesta. Mongoose además rechaza la cadena
  // vacía en campos required, así que exigirlo rompería el alta mínima.
  telefono: { type: String },
  email: { type: String },
  estado: { type: String, enum: ['activo', 'inactivo', 'pendiente'], default: 'pendiente' },
  fechaInicio: { type: Date, required: true },
  fechaVencimiento: { type: Date, required: true },
  esRecurrente: { type: Boolean, default: false },
  historialRenovaciones: [{ fecha: Date, monto: Number }],
  encuestaData: { type: Schema.Types.Mixed },
  // Sellos del embudo. Ausentes en los clientes anteriores a la tanda 4: los que
  // ya tienen `encuestaData` convirtieron en una fecha que no se registró, y el
  // KPI los trata como convertidos sin imputarlos a ningún período.
  fechaConversion: { type: Date },
  fechaPrimerContacto: { type: Date },
  // Último envío del formulario de ingreso al socio. Sin índice a propósito: se lee
  // siempre junto con la ficha que ya se trajo, nunca como filtro de búsqueda.
  fechaFormularioEnviado: { type: Date },
  // Ausente en clientes cargados antes de este campo: el dominio lo trata como
  // CONSUMIDOR_FINAL (default explícito acá para que quede igual en Mongo).
  condicionFiscal: {
    type: String,
    enum: CONDICIONES_FISCALES_CLIENTE,
    default: ClientTaxCondition.CONSUMIDOR_FINAL
  },
  // Solo se completa (y se exige en el use case) cuando condicionFiscal es RI.
  cuit: { type: String },
}, { timestamps: true });

// Índices clave para el buscador (nombre + documento)
clientSchema.index({ gymId: 1, documento: 1 });
clientSchema.index({ gymId: 1, nombre: 'text' });
clientSchema.index({ gymId: 1, fechaVencimiento: 1 });
clientSchema.index({ gymId: 1, estado: 1 });
// El embudo lee por cohorte de alta y por fecha de conversión. Sin estos dos, cada
// consulta de KPIs barre la colección entera del gym.
clientSchema.index({ gymId: 1, createdAt: 1 });
clientSchema.index({ gymId: 1, fechaConversion: 1 });

export const ClientModel = model<ClientDocument>('Client', clientSchema);
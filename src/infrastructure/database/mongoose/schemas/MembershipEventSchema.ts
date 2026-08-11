import { Schema, model, Types } from 'mongoose';

export interface MembershipEventDbDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  tipo: 'alta' | 'renovacion' | 'ajuste';
  fecha: Date;
  monto?: number;
  vencimientoAnterior?: Date;
  vencimientoNuevo?: Date;
  origen: 'operacion' | 'historico';
  createdAt: Date;
  updatedAt: Date;
}

const membershipEventSchema = new Schema<MembershipEventDbDocument>(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    tipo: { type: String, enum: ['alta', 'renovacion', 'ajuste'], required: true },
    fecha: { type: Date, required: true },
    // Sin default 0: "no hubo cobro" y "cobró cero" son cosas distintas, y un 0 por
    // omisión se sumaría a los ingresos como si fuera un pago real.
    monto: { type: Number },
    vencimientoAnterior: { type: Date },
    // Sin required: ausente significa "no consta", que es el estado legítimo de las
    // renovaciones sembradas desde el historial viejo. Ver MembershipEvent.
    vencimientoNuevo: { type: Date },
    origen: { type: String, enum: ['operacion', 'historico'], default: 'operacion' },
  },
  { timestamps: true }
);

// El acceso real es "todo el historial de un gym, en orden": es lo que arma el
// cálculo de KPIs de una sola pasada.
membershipEventSchema.index({ gymId: 1, fecha: 1 });
membershipEventSchema.index({ gymId: 1, clientId: 1, fecha: 1 });

export const MembershipEventModel = model<MembershipEventDbDocument>(
  'MembershipEvent',
  membershipEventSchema
);

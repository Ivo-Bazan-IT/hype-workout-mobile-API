import { Schema, model, Types } from 'mongoose';
import { CONDICIONES_FISCALES, GymTaxCondition } from '../../../../domain/billing/types';

export interface GymDocument {
  _id: Types.ObjectId;
  name: string;
  businessName: string;
  cuit: string;
  contactEmail: string;
  contactPhone: string;
  isActive: boolean;
  aiConfig: {
    provider: 'deepseek' | 'openai' | 'anthropic';
    promptTemplate: string;
    model?: string;
    encryptedApiKey?: string; // AES-256-GCM encrypted (BYOK por gym)
  };
  whatsappConfig: {
    phoneNumberId: string;
    tokenSecretRef: string;
    encryptedAccessToken?: string; // AES-256-GCM encrypted (BYOK por gym)
  };
  pdfTemplate: {
    htmlTemplate?: string;
    cssStyles?: string;
    storagePath?: string;
  };
  googleFormConfig: {
    formId?: string;
    formUrl?: string;
    documentoEntryId?: string;
    webhookSecretHash?: string; // bcrypt: solo hay que verificarlo, nunca leerlo
    webhookSecretUpdatedAt?: Date;
    fieldMapping?: {
      nombre?: string;
      documento?: string;
      telefono?: string;
      email?: string;
      edad?: string;
      objetivo?: string;
      lesiones?: string;
      diasPorSemana?: string;
    };
  };
  timezone?: string; // Nombre IANA. Ausente = usar ZONA_HORARIA_DEFAULT
  afipConfig: {
    puntoVenta: number;
    taxCondition: GymTaxCondition;
    encryptedApiKey?: string; // AES-256-GCM encrypted (cuenta propia por gym)
    encryptedCert?: string; // AES-256-GCM encrypted (cuenta propia por gym)
    encryptedKey?: string; // AES-256-GCM encrypted (cuenta propia por gym)
    credencialesActualizadasEn?: Date;
    isActive: boolean;
  };
  mercadoPagoConfig?: {
    encryptedAccessToken?: string; // AES-256-GCM encrypted (OAuth propio del gym)
    encryptedRefreshToken?: string; // AES-256-GCM encrypted
    mpUserId?: string; // user_id de MP del vendedor conectado — clave del webhook
    expiraEn?: Date;
    conectadoEn?: Date;
  };
  membershipPlans: {
    tipo: 'mensual' | 'trimestral' | 'semestral' | 'anual';
    duracionDias: number;
    monto: number;
    activo: boolean;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const gymSchema = new Schema<GymDocument>({
  name: { type: String, required: true },
  businessName: { type: String, required: true },
  cuit: { type: String, required: true, unique: true },
  contactEmail: { type: String, required: true },
  contactPhone: { type: String, required: true },
  isActive: { type: Boolean, default: true },

  aiConfig: {
    provider: { type: String, enum: ['deepseek', 'openai', 'anthropic'], default: 'deepseek' },
    promptTemplate: { type: String, required: true },
    model: { type: String },
    encryptedApiKey: { type: String }, // AES-256-GCM encrypted (BYOK por gym)
  },

  whatsappConfig: {
    // No es required: un gym puede existir antes de configurar WhatsApp, y Mongoose
    // rechaza la cadena vacía en un campo required (rompía el alta de todo tenant).
    phoneNumberId: { type: String, default: '' },
    tokenSecretRef: { type: String, default: '' },
    encryptedAccessToken: { type: String }, // AES-256-GCM encrypted (BYOK por gym)
  },

  pdfTemplate: {
    htmlTemplate: { type: String },
    cssStyles: { type: String },
    // Reservado: sin endpoint de subida todavía, hoy siempre se usa el fondo standard
    storagePath: { type: String },
  },

  googleFormConfig: {
    formId: { type: String },
    // El link que se le manda al socio por WhatsApp y el campo del DNI dentro de ese
    // link. Juntos son los que hacen posible el formulario prellenado; sin el segundo
    // el envío sigue andando, pero el socio tipea su documento a mano.
    formUrl: { type: String },
    documentoEntryId: { type: String },
    // Hash bcrypt del secreto del webhook. El valor en claro no se guarda en ningún
    // lado: se muestra una sola vez al rotarlo (ver RotateGoogleFormSecretUseCase).
    webhookSecretHash: { type: String },
    webhookSecretUpdatedAt: { type: Date },
    // Título exacto de la pregunta del Form que alimenta cada campo. Los cuatro
    // primeros son columnas del cliente; los cuatro últimos viven en `encuestaData`
    // y alimentan los placeholders sueltos del prompt de generación.
    fieldMapping: {
      nombre: { type: String },
      documento: { type: String },
      telefono: { type: String },
      email: { type: String },
      edad: { type: String },
      objetivo: { type: String },
      lesiones: { type: String },
      diasPorSemana: { type: String },
    },
  },

  // Zona horaria del gimnasio (IANA). Sin default a nivel schema a propósito: el
  // default vive en el dominio (`ZONA_HORARIA_DEFAULT`) y los endpoints que agrupan
  // por hora devuelven cuál usaron. Grabarlo acá haría que un gym que nunca la
  // configuró se vuelva indistinguible de uno que eligió Buenos Aires.
  timezone: { type: String },

  afipConfig: {
    puntoVenta: { type: Number, default: 1 },
    taxCondition: {
      type: String,
      // La lista sale del dominio: agregar una condición fiscal en dos lugares es
      // la forma segura de que el enum de Mongo y el del negocio se separen.
      enum: CONDICIONES_FISCALES,
      default: GymTaxCondition.MONOTRIBUTO
    },
    // Credencial de la cuenta PROPIA de AFIP SDK del gym (modo `cuenta_propia`).
    // Se cargan por PUT /gyms/settings/afip/credenciales, nunca en este PUT.
    encryptedApiKey: { type: String },
    encryptedCert: { type: String },
    encryptedKey: { type: String },
    credencialesActualizadasEn: { type: Date },
    isActive: { type: Boolean, default: false }
  },

  // Conexión OAuth con la cuenta de Mercado Pago del gym. Sin `default` a nivel
  // objeto, a propósito: un gym que nunca conectó no tiene ninguno de estos campos,
  // ni siquiera un objeto vacío — es la señal que usa el front para mostrar
  // "no conectado" en vez de un formulario a medio completar.
  mercadoPagoConfig: {
    encryptedAccessToken: { type: String },
    encryptedRefreshToken: { type: String },
    mpUserId: { type: String, index: true },
    expiraEn: { type: Date },
    conectadoEn: { type: Date },
  },

  // Catálogo de precios por plan. Alimenta tanto el link de Mercado Pago como la
  // renovación manual en efectivo (POST /clients/:id/renew con tipoPlan).
  membershipPlans: {
    type: [
      {
        tipo: { type: String, enum: ['mensual', 'trimestral', 'semestral', 'anual'], required: true },
        duracionDias: { type: Number, required: true },
        monto: { type: Number, required: true },
        activo: { type: Boolean, default: true },
      },
    ],
    default: [],
  },
}, { timestamps: true });

export const GymModel = model<GymDocument>('Gym', gymSchema);
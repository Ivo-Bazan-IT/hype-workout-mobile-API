import { Schema, model, Types } from 'mongoose';

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
    taxCondition: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO' | 'EXENTO';
    apiKeySecretRef: string; // Referencia al secret manager
    encryptedApiKey?: string; // AES-256-GCM encrypted
    isActive: boolean;
  };
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
    taxCondition: { type: String, enum: ['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO', 'EXENTO'], default: 'MONOTRIBUTO' },
    apiKeySecretRef: { type: String, default: '' },
    encryptedApiKey: { type: String }, // AES-256-GCM encrypted
    isActive: { type: Boolean, default: false }
  },
}, { timestamps: true });

export const GymModel = model<GymDocument>('Gym', gymSchema);
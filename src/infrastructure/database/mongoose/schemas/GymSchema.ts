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
    provider: 'openai' | 'anthropic';
    promptTemplate: string;
    model?: string;
  };
  whatsappConfig: {
    phoneNumberId: string;
    tokenSecretRef: string;
  };
  pdfTemplate: {
    storagePath?: string;
    fieldsMap?: Record<string, { x: number; y: number; page: number; fontSize: number }>;
  };
  googleFormConfig: {
    formId?: string;
    webhookSecret?: string;
  };
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
    provider: { type: String, enum: ['openai', 'anthropic'], default: 'openai' },
    promptTemplate: { type: String, required: true },
    model: { type: String },
  },

  whatsappConfig: {
    phoneNumberId: { type: String, required: true },
    tokenSecretRef: { type: String, required: true },
  },

  pdfTemplate: {
    storagePath: { type: String },
    fieldsMap: { type: Schema.Types.Mixed },
  },

  googleFormConfig: {
    formId: { type: String },
    webhookSecret: { type: String },
  },

  afipConfig: {
    puntoVenta: { type: Number, default: 1 },
    taxCondition: { type: String, enum: ['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO', 'EXENTO'], default: 'MONOTRIBUTO' },
    apiKeySecretRef: { type: String, default: '' },
    encryptedApiKey: { type: String }, // AES-256-GCM encrypted
    isActive: { type: Boolean, default: false }
  },
}, { timestamps: true });

export const GymModel = model<GymDocument>('Gym', gymSchema);
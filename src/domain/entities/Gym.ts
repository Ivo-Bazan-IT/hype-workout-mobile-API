export interface AiConfig {
  provider: 'openai' | 'anthropic';
  promptTemplate: string;
  model?: string;
}

export interface WhatsappConfig {
  phoneNumberId: string;
  tokenSecretRef: string;
}

export interface PdfTemplate {
  storagePath?: string;
  fieldsMap?: Record<string, { x: number; y: number; page: number; fontSize: number }>;
}

export interface GoogleFormConfig {
  formId?: string;
  webhookSecret?: string;
}

export interface AfipConfig {
  puntoVenta: number;
  taxCondition: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO' | 'EXENTO';
  apiKeySecretRef: string; // Referencia a secret manager externo (AWS, Doppler, etc.)
  encryptedApiKey?: string;  // API key encriptada con AES-256-GCM
  isActive: boolean;
}

export interface Gym {
  id: string;
  name: string;
  businessName: string;
  cuit: string;
  contactEmail: string;
  contactPhone: string;
  isActive: boolean;
  aiConfig: AiConfig;
  whatsappConfig: WhatsappConfig;
  pdfTemplate: PdfTemplate;
  googleFormConfig: GoogleFormConfig;
  afipConfig?: AfipConfig;
  createdAt: Date;
  updatedAt: Date;
}

export class GymEntity implements Gym {
  constructor(
    public id: string,
    public name: string,
    public businessName: string,
    public cuit: string,
    public contactEmail: string,
    public contactPhone: string,
    public isActive: boolean = true,
    public aiConfig: AiConfig = { provider: 'openai', promptTemplate: '' },
    public whatsappConfig: WhatsappConfig = { phoneNumberId: '', tokenSecretRef: '' },
    public pdfTemplate: PdfTemplate = {},
    public googleFormConfig: GoogleFormConfig = {},
    public afipConfig?: AfipConfig,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class GymMapper {
  static toDomain(doc: any): Gym {
    return new GymEntity(
      doc._id.toString(),
      doc.name,
      doc.businessName,
      doc.cuit,
      doc.contactEmail,
      doc.contactPhone,
      doc.isActive,
      doc.aiConfig,
      doc.whatsappConfig,
      doc.pdfTemplate,
      doc.googleFormConfig,
      doc.afipConfig,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: GymEntity): any {
    return {
      _id: entity.id,
      name: entity.name,
      businessName: entity.businessName,
      cuit: entity.cuit,
      contactEmail: entity.contactEmail,
      contactPhone: entity.contactPhone,
      isActive: entity.isActive,
      aiConfig: entity.aiConfig,
      whatsappConfig: entity.whatsappConfig,
      pdfTemplate: entity.pdfTemplate,
      googleFormConfig: entity.googleFormConfig,
      afipConfig: entity.afipConfig,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
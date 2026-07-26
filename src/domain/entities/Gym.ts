/**
 * Proveedores de IA soportados. `deepseek` usa una API compatible con OpenAI
 * (mismo SDK, otro baseURL) y es el default por costo: es el que mantiene barato
 * el mantenimiento al escalar la cantidad de rutinas generadas.
 */
export const AI_PROVIDERS = ['deepseek', 'openai', 'anthropic'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiConfig {
  provider: AiProvider;
  promptTemplate: string;
  model?: string;
  /**
   * API key del proveedor de IA, propia del gym (BYOK), cifrada con AES-256-GCM.
   * Cada tenant paga su propio consumo: sin esto todos los gyms compartían la key
   * de la plataforma y uno solo podía agotarle la cuota al resto.
   * NUNCA se expone por HTTP, ni siquiera cifrada.
   */
  encryptedApiKey?: string;
}

export interface WhatsappConfig {
  phoneNumberId: string;
  tokenSecretRef: string;
  /**
   * Access token de Meta Cloud API propio del gym, cifrado con AES-256-GCM.
   * Va de la mano del `phoneNumberId`: el PDF tiene que salir del número del gym,
   * no de un número compartido. NUNCA se expone por HTTP.
   */
  encryptedAccessToken?: string;
}

export interface PdfTemplate {
  /**
   * HTML propio del gym para el PDF de la rutina. Si falta, se usa la plantilla
   * standard de la plataforma. Se guarda como string en el documento (igual que
   * `aiConfig.promptTemplate`) y está topeado en tamaño: las imágenes van por URL,
   * no embebidas. Ver `domain/pdf/routineTemplate.ts`.
   */
  htmlTemplate?: string;
  cssStyles?: string;
  /**
   * Ruta al PDF de fondo propio del gym.
   *
   * RESERVADO: la subida de archivos todavía NO está implementada, así que hoy
   * siempre se estampa sobre el fondo standard. El campo y la lógica de resolución
   * (`resolverPlantillaPdf`) ya lo contemplan para no tener que rehacerlas cuando
   * se agregue el endpoint de subida.
   */
  storagePath?: string;
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
    public aiConfig: AiConfig = { provider: 'deepseek', promptTemplate: '' },
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
/**
 * Proveedores de IA soportados. `deepseek` usa una API compatible con OpenAI
 * (mismo SDK, otro baseURL) y es el default por costo: es el que mantiene barato
 * el mantenimiento al escalar la cantidad de rutinas generadas.
 */
import { FormFieldMapping } from '../forms/fieldMapping';

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
  /**
   * Qué pregunta del Form alimenta cada campo del cliente. Sin esto se cae a una
   * heurística por alias que puede equivocarse de pregunta. Ver
   * `domain/forms/fieldMapping`.
   */
  fieldMapping?: FormFieldMapping;
  /**
   * Hash bcrypt del secreto que firma los webhooks del Form del gym.
   *
   * Va hasheado y no cifrado como el resto de las credenciales porque el webhook
   * solo necesita VERIFICARLO, nunca leerlo: no hay motivo para que sea
   * recuperable. El valor en claro se muestra una única vez al rotarlo y, si se
   * pierde, se rota de nuevo. NUNCA se expone por HTTP, ni siquiera el hash.
   */
  webhookSecretHash?: string;
  /**
   * Última rotación. Es lo que le permite al front decir "configurado el 29/07"
   * sin tener que mostrar el secreto.
   */
  webhookSecretUpdatedAt?: Date;
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
  /**
   * Zona horaria del gimnasio, como nombre IANA
   * (`America/Argentina/Buenos_Aires`, `America/Santiago`...).
   *
   * Es lo que decide qué día calendario y qué franja horaria le corresponde a un
   * instante: el mapa de calor de asistencia y la idempotencia diaria del check-in
   * salen de acá. Ausente significa "no la configuró", y ahí se usa
   * `ZONA_HORARIA_DEFAULT` — nunca la del proceso Node, que depende de dónde esté
   * desplegado el server y no del gimnasio.
   */
  timezone?: string;
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
    public timezone?: string,
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
      doc.timezone,
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
      timezone: entity.timezone,
      afipConfig: entity.afipConfig,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
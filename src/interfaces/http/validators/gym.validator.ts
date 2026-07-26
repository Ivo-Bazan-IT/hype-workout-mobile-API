import { z } from 'zod';
import { AI_PROVIDERS } from '../../../domain/entities/Gym';

export const createGymSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  businessName: z.string().min(1, 'Business name is required'),
  cuit: z.string().min(11, 'CUIT must be at least 11 characters'),
  contactEmail: z.string().email('Valid email required'),
  contactPhone: z.string().min(10, 'Phone must be at least 10 characters'),
  adminEmail: z.string().email('Admin email required'),
  adminPassword: z.string().min(6, 'Password must be at least 6 characters'),
  adminName: z.string().min(1, 'Admin name required'),
  // CreateGymUseCase ya los soporta; sin declararlos acá, validateBody los
  // descartaba al reemplazar req.body con el resultado del parse.
  aiProvider: z.enum(AI_PROVIDERS).optional(),
  whatsappPhoneNumberId: z.string().min(1).optional(),
  // Se cifra en el caso de uso. Permite dejar el gym operativo en una sola llamada.
  whatsappAccessToken: z.string().min(1).optional(),
});

export const updateGymSchema = z.object({
  name: z.string().min(1).optional(),
  businessName: z.string().min(1).optional(),
  cuit: z.string().min(11).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().min(10).optional(),
  // Reactivar es el inverso del soft delete de `DELETE /admin/gyms/:id`: sin este
  // campo el `validateBody` lo descartaba y el gym quedaba inactivo para siempre.
  isActive: z.boolean().optional(),
  // WhatsApp por campos PLANOS, no como objeto `whatsappConfig`.
  //
  // Aceptar el objeto entero lo reemplazaba completo y borraba el
  // `encryptedAccessToken` del gym, que no viaja en el body por ser secreto: se
  // editaba el teléfono del gimnasio y se perdía la credencial en silencio. Estos
  // dos campos hacen merge y cifran, igual que /api/gyms/settings/whatsapp.
  whatsappPhoneNumberId: z.string().min(1).optional(),
  whatsappAccessToken: z.string().min(1).optional(),
  // `aiConfig` se quitó por la misma razón: reemplazarlo borraba `encryptedApiKey`.
  // El prompt, el proveedor y la key del gym se editan con
  // PUT /api/gyms/settings/ai-prompt?gymId=<id>, que hace merge.
  pdfTemplate: z.object({
    htmlTemplate: z.string().optional(),
    cssStyles: z.string().optional(),
    storagePath: z.string().optional(),
  }).optional(),
  googleFormConfig: z.object({
    formId: z.string().optional(),
    webhookSecret: z.string().optional(),
  }).optional(),
});

export const updateAiConfigSchema = z
  .object({
    promptTemplate: z.string().min(1, 'Prompt template is required').optional(),
    provider: z.enum(AI_PROVIDERS).optional(),
    model: z.string().min(1).optional(),
    // API key propia del gym (BYOK). Se cifra en el caso de uso; jamás se devuelve.
    apiKey: z.string().min(1, 'API key cannot be empty').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const updateWhatsappConfigSchema = z
  .object({
    phoneNumberId: z.string().min(1, 'Phone number ID cannot be empty').optional(),
    accessToken: z.string().min(1, 'Access token cannot be empty').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const updateAfipConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  puntoVenta: z.number().int().positive().optional(),
  taxCondition: z.enum(['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO', 'EXENTO']).optional(),
  isActive: z.boolean().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(1, 'Password is required'),
});
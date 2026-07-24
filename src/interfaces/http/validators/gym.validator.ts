import { z } from 'zod';

export const createGymSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  businessName: z.string().min(1, 'Business name is required'),
  cuit: z.string().min(11, 'CUIT must be at least 11 characters'),
  contactEmail: z.string().email('Valid email required'),
  contactPhone: z.string().min(10, 'Phone must be at least 10 characters'),
  adminEmail: z.string().email('Admin email required'),
  adminPassword: z.string().min(6, 'Password must be at least 6 characters'),
  adminName: z.string().min(1, 'Admin name required'),
});

export const updateGymSchema = z.object({
  name: z.string().min(1).optional(),
  businessName: z.string().min(1).optional(),
  cuit: z.string().min(11).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().min(10).optional(),
  aiConfig: z.object({
    provider: z.enum(['openai', 'anthropic']),
    promptTemplate: z.string(),
    model: z.string().optional(),
  }).optional(),
  whatsappConfig: z.object({
    phoneNumberId: z.string(),
    tokenSecretRef: z.string(),
  }).optional(),
  pdfTemplate: z.object({
    storagePath: z.string().optional(),
    fieldsMap: z.record(z.any()).optional(),
  }).optional(),
  googleFormConfig: z.object({
    formId: z.string().optional(),
    webhookSecret: z.string().optional(),
  }).optional(),
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
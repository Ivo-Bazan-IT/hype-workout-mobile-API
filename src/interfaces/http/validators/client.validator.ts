import { z } from 'zod';

// Alta mínima: solo nombre y documento son obligatorios. El resto se completa
// después con PATCH /api/clients/:id/encuesta. Si no se envían fechas, el caso de
// uso aplica el mismo default de 30 días que usa el onboarding por formulario.
export const createClientSchema = z.object({
  nombre: z.string().min(1, 'Nombre es requerido'),
  documento: z.string().min(1, 'Documento es requerido'),
  telefono: z.string().min(10, 'Teléfono debe tener al menos 10 dígitos').optional(),
  email: z.string().email('Email inválido').optional(),
  fechaInicio: z.coerce.date({ invalid_type_error: 'Fecha de inicio inválida' }).optional(),
  fechaVencimiento: z.coerce.date({ invalid_type_error: 'Fecha de vencimiento inválida' }).optional(),
  encuestaData: z.record(z.any()).optional(),
});

export const updateClientSchema = z.object({
  nombre: z.string().min(1).optional(),
  documento: z.string().min(1).optional(),
  telefono: z.string().min(10).optional(),
  email: z.string().email().optional(),
  estado: z.enum(['activo', 'inactivo', 'pendiente']).optional(),
  fechaVencimiento: z.coerce.date().optional(),
  encuestaData: z.record(z.any()).optional(),
});

// PATCH de la encuesta: `encuestaData` es obligatorio (es el objeto de este endpoint)
// y se FUSIONA con lo ya cargado. `telefono` y `email` son los datos de contacto que
// típicamente llegan en la encuesta y viven como campos propios del cliente.
export const updateClientSurveySchema = z.object({
  telefono: z.string().min(10, 'Teléfono debe tener al menos 10 dígitos').optional(),
  email: z.string().email('Email inválido').optional(),
  encuestaData: z
    .record(z.any())
    .refine((data) => Object.keys(data).length > 0, {
      message: 'encuestaData no puede estar vacío',
    }),
});

// Registrar el primer contacto con un lead. `fecha` es opcional: sin ella se toma
// el momento del request. El caso de uso rechaza las futuras y las anteriores al
// alta del cliente — eso no se puede validar acá porque depende del cliente.
export const registerFirstContactSchema = z.object({
  fecha: z.coerce.date({ invalid_type_error: 'Fecha inválida' }).optional(),
});

export const searchClientsSchema = z.object({
  query: z.string().optional(),
  estado: z.enum(['activo', 'inactivo', 'pendiente']).optional(),
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('20'),
});

export const renewClientSchema = z.object({
  monto: z.number().positive('Monto debe ser positivo'),
});
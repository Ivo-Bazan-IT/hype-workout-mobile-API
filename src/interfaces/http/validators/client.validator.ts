import { z } from 'zod';
import { CONDICIONES_FISCALES_CLIENTE } from '../../../domain/billing/types';

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
  // Ausente => CONSUMIDOR_FINAL (default del caso de uso y del schema de Mongo).
  // Cuando es RESPONSABLE_INSCRIPTO, el caso de uso exige `cuit` válido.
  condicionFiscal: z.enum(CONDICIONES_FISCALES_CLIENTE as [string, ...string[]]).optional(),
  cuit: z.string().min(11, 'CUIT debe tener al menos 11 dígitos').optional(),
});

export const updateClientSchema = z.object({
  nombre: z.string().min(1).optional(),
  documento: z.string().min(1).optional(),
  telefono: z.string().min(10).optional(),
  email: z.string().email().optional(),
  estado: z.enum(['activo', 'inactivo', 'pendiente']).optional(),
  fechaVencimiento: z.coerce.date().optional(),
  encuestaData: z.record(z.any()).optional(),
  condicionFiscal: z.enum(CONDICIONES_FISCALES_CLIENTE as [string, ...string[]]).optional(),
  cuit: z.string().min(11, 'CUIT debe tener al menos 11 dígitos').optional(),
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

// `tipoPlan` es el camino recomendado (resuelve monto y vencimiento desde el
// catálogo del gym); `monto` sigue existiendo para un cobro que no calza con
// ningún plan (una promo, un ajuste). Al menos uno de los dos tiene que venir.
export const renewClientSchema = z
  .object({
    monto: z.number().positive('Monto debe ser positivo').optional(),
    tipoPlan: z.enum(['mensual', 'trimestral', 'semestral', 'anual']).optional(),
  })
  .refine((data) => data.monto !== undefined || data.tipoPlan !== undefined, {
    message: 'Hay que indicar monto o tipoPlan',
  });

// POST /clients/:id/renewal-requests — dispara el link de pago de Mercado Pago.
// A diferencia de /renew, acá SIEMPRE es por catálogo: no tiene sentido un link
// de pago por un monto que el gym no definió como plan.
export const createRenewalRequestSchema = z.object({
  tipoPlan: z.enum(['mensual', 'trimestral', 'semestral', 'anual'], {
    errorMap: () => ({ message: 'tipoPlan debe ser mensual, trimestral, semestral o anual' }),
  }),
});
import { z } from 'zod';

export const createClientSchema = z.object({
  nombre: z.string().min(1, 'Nombre es requerido'),
  documento: z.string().min(1, 'Documento es requerido'),
  telefono: z.string().min(10, 'Teléfono debe tener al menos 10 dígitos'),
  email: z.string().email('Email inválido').optional(),
  fechaInicio: z.string().datetime('Fecha de inicio inválida'),
  fechaVencimiento: z.string().datetime('Fecha de vencimiento inválida'),
  encuestaData: z.record(z.any()).optional(),
});

export const updateClientSchema = z.object({
  nombre: z.string().min(1).optional(),
  documento: z.string().min(1).optional(),
  telefono: z.string().min(10).optional(),
  email: z.string().email().optional(),
  estado: z.enum(['activo', 'inactivo', 'pendiente']).optional(),
  fechaVencimiento: z.string().datetime().optional(),
  encuestaData: z.record(z.any()).optional(),
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
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(1, 'Name is required'),
  gymId: z.string().min(1, 'gymId is required'),
});

export const updateUserSchema = z.object({
  email: z.string().email('Valid email required').optional(),
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  gymId: z.string().min(1).optional(),
});

export const resetUserPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const searchUsersSchema = z.object({
  q: z.string().optional(),
  role: z.enum(['admin', 'gym']).optional(),
  gymId: z.string().optional(),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('20'),
});

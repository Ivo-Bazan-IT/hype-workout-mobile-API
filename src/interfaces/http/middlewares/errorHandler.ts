import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../../shared/errors/AppError';

/**
 * Handler central de errores. Traduce a HTTP los errores que llegan por next(error):
 *
 * - AppError y su jerarquía  → su propio statusCode (404, 409, 403, ...)
 * - ZodError                 → 400 con el detalle por campo. Los validadores
 *                              (validateBody/validateQuery) hacen next(error) con
 *                              el ZodError crudo; sin este caso caían en el 500.
 * - ValidationError/CastError de Mongoose → 400. Un :id malformado es entrada
 *                              inválida del cliente, no una falla del servidor.
 * - resto                    → 500 sin filtrar detalles internos al cliente.
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): Response => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return res.status(400).json({
      status: 'error',
      message: err.message
    });
  }

  // Log error in production
  console.error('Unexpected error:', err);

  return res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
};

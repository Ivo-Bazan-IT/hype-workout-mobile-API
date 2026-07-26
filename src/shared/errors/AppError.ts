export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    isOperational = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409);
  }
}

/**
 * El proveedor externo limitó la cuota. 429 y no 500 para que el cliente sepa que
 * el reintento tiene sentido: no se rompió nada, hay que esperar.
 */
export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429);
  }
}

/**
 * Un servicio externo (IA, WhatsApp, AFIP) falló por su cuenta.
 *
 * 502 y no 500: el 500 dice "el backend tiene un bug" y manda a depurar donde no
 * hay nada roto. El 502 dice "el de afuera falló", que es lo que pasó.
 */
export class ExternalServiceError extends AppError {
  constructor(message = 'External service failed') {
    super(message, 502);
  }
}
import { describe, it, expect } from 'vitest';
import { traducirErrorDeIA } from '../../../src/infrastructure/external/ai/aiErrors';
import {
  ExternalServiceError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../../../src/shared/errors/AppError';

/** Imita la forma de los errores de los SDKs: status HTTP + message. */
const errorDelSdk = (status: number, message: string): Error =>
  Object.assign(new Error(message), { status });

describe('traducirErrorDeIA', () => {
  it('mapea el rate limit a 429, para que el reintento se sepa útil', () => {
    // Es el caso real de la capa gratuita compartida: nada se rompió, hay que esperar
    const traducido = traducirErrorDeIA(
      errorDelSdk(429, 'Provider returned error'),
      'deepseek'
    );

    expect(traducido).toBeInstanceOf(RateLimitError);
    expect(traducido.statusCode).toBe(429);
    expect(traducido.message).toContain('deepseek');
  });

  it('mapea una API key rechazada a 400, NO a 401', () => {
    // Un 401 hacia el front se lee como "sesión expirada" y mandaría al usuario al
    // login. La sesión está bien: lo que está mal es la key del gym.
    const traducido = traducirErrorDeIA(
      errorDelSdk(401, 'invalid x-api-key'),
      'anthropic'
    );

    expect(traducido).toBeInstanceOf(ValidationError);
    expect(traducido.statusCode).toBe(400);
    expect(traducido.message).toContain('gym settings');
  });

  it('propaga el mensaje del proveedor cuando el modelo está mal', () => {
    // El mensaje real que nos costó una depuración: sin propagarlo, era un 500 mudo
    const traducido = traducirErrorDeIA(
      errorDelSdk(400, "Model ID 'deepseek-chat' is ambiguous"),
      'deepseek'
    );

    expect(traducido.statusCode).toBe(400);
    expect(traducido.message).toContain("Model ID 'deepseek-chat' is ambiguous");
  });

  it('mapea un fallo del proveedor a 502 y no a 500', () => {
    // 500 diría "el backend tiene un bug" y mandaría a depurar donde no hay nada roto
    const traducido = traducirErrorDeIA(errorDelSdk(503, 'upstream down'), 'openai');

    expect(traducido).toBeInstanceOf(ExternalServiceError);
    expect(traducido.statusCode).toBe(502);
  });

  it('trata un error sin status (timeout, DNS) como fallo del proveedor', () => {
    const traducido = traducirErrorDeIA(new Error('socket hang up'), 'openai');

    expect(traducido).toBeInstanceOf(ExternalServiceError);
    expect(traducido.message).toContain('socket hang up');
  });

  it('deja pasar un AppError ya traducido sin volver a envolverlo', () => {
    const original = new NotFoundError('Gym');

    expect(traducirErrorDeIA(original, 'openai')).toBe(original);
  });

  it('recorta mensajes largos del proveedor', () => {
    const traducido = traducirErrorDeIA(errorDelSdk(500, 'x'.repeat(5000)), 'openai');

    expect(traducido.message.length).toBeLessThan(500);
  });
});

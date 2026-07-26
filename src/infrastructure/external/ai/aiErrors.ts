import { AiProvider } from '../../../domain/entities/Gym';
import {
  AppError,
  ExternalServiceError,
  RateLimitError,
  ValidationError,
} from '../../../shared/errors/AppError';

/**
 * Traduce los errores de los SDKs de IA a la jerarquía de `AppError`.
 *
 * Es trabajo del adaptador: traducir el vocabulario del vendor al del dominio. Sin
 * esto, cualquier fallo del proveedor llegaba al `errorHandler` como un error
 * desconocido y salía como `500 Internal server error`, indistinguible de un bug
 * del backend. Depurar eso significa mirar el log del servidor para descubrir que
 * el modelo estaba rate-limited.
 *
 * Los tres SDKs (OpenAI, Anthropic y el compatible que usa DeepSeek) exponen el
 * status HTTP en `error.status`, así que alcanza un mapeo por status.
 */

/** Mensajes largos del proveedor: útiles, pero no para volcarlos enteros al cliente. */
const MAX_DETALLE = 300;

const detalleDe = (error: unknown): string => {
  const mensaje = (error as { message?: string })?.message ?? '';
  return mensaje.slice(0, MAX_DETALLE);
};

export const traducirErrorDeIA = (error: unknown, provider: AiProvider): AppError => {
  // Un AppError ya traducido (p.ej. el que lanza el propio adaptador) pasa derecho
  if (error instanceof AppError) {
    return error;
  }

  const status = (error as { status?: number })?.status;
  const detalle = detalleDe(error);

  if (status === 429) {
    return new RateLimitError(
      `The AI provider "${provider}" is rate-limited. Retry in a few minutes, or load the gym's own API key to stop sharing the platform quota. Provider said: ${detalle}`
    );
  }

  if (status === 401 || status === 403) {
    // 400 y NO 401: un 401 hacia el front se lee como "tu sesión expiró" y lo
    // mandaría a la pantalla de login. Acá la sesión está perfecta; lo que está
    // mal es la API key configurada, y eso lo arregla el dueño del gym.
    return new ValidationError(
      `The API key configured for "${provider}" was rejected by the provider. Check it in the gym settings. Provider said: ${detalle}`
    );
  }

  if (status === 400 || status === 404 || status === 422) {
    // Típicamente un modelo inexistente o mal nombrado. El mensaje del proveedor
    // suele decir exactamente qué corregir, así que se propaga.
    return new ValidationError(
      `The AI provider "${provider}" rejected the request, usually a wrong model name. Provider said: ${detalle}`
    );
  }

  // 5xx, timeouts, DNS, socket cerrado: no hay nada que el gym pueda configurar
  return new ExternalServiceError(
    `The AI provider "${provider}" failed${status ? ` with status ${status}` : ''}. Provider said: ${detalle}`
  );
};

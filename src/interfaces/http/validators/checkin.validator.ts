import { z } from 'zod';

// `fecha` es opcional: el caso normal es el ingreso de ahora mismo y lo resuelve el
// borde. Se acepta explícita para poder cargar a mano una asistencia que el
// mostrador no registró en el momento.
export const registerCheckInSchema = z.object({
  clientId: z.string().min(1, 'clientId es requerido'),
  fecha: z.coerce.date({ invalid_type_error: 'Fecha inválida' }).optional(),
});

/**
 * Filtros del historial de asistencia.
 *
 * `page` y `limit` se coercionan y se validan, no solo se convierten: con
 * `z.string().transform(Number)` un `?page=abc` producía `NaN`, que pasaba la
 * validación, llegaba a `.skip()` y terminaba en un 500 — una entrada malformada
 * disfrazada de falla del servidor. Y `?page=0` daba un `skip` negativo, que Mongo
 * rechaza.
 *
 * El tope de `limit` es 500 y es un número acordado con el front, no una cifra
 * defensiva al azar: es la ventana con la que pagina las 8 semanas de asistencia
 * del mapa de calor mientras `GET /checkins/heatmap` no exista. Sin tope, un
 * `?limit=100000` traía la colección entera a memoria.
 */
export const searchCheckInsSchema = z.object({
  clientId: z.string().optional(),
  desde: z.coerce.date({ invalid_type_error: 'desde inválida' }).optional(),
  hasta: z.coerce.date({ invalid_type_error: 'hasta inválida' }).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(20),
});

/**
 * Ventana del mapa de calor, en semanas hacia atrás.
 *
 * 8 por defecto porque es el horizonte con el que el patrón semanal ya se estabilizó
 * sin arrastrar temporadas viejas: el mapa responde "cuándo se llena HOY", y un año
 * de historia promedia el verano con el invierno y aplana justo lo que se quiere ver.
 * El techo de 52 deja pedir el año entero para quien lo quiera igual.
 */
export const checkInHeatmapSchema = z.object({
  semanas: z.coerce.number().int().positive().max(52).default(8),
});

import { AiProvider } from '../entities/Gym';

/**
 * Con qué credencial se atiende a un gym cuando hay que generarle una rutina.
 *
 * Módulo puro: sin SDKs, sin Mongoose, sin env. Vive en el dominio porque "a qué
 * modelo degrado cuando el gimnasio todavía no cargó su key" es una regla de
 * negocio (define quién paga el consumo), no un detalle del adaptador.
 */

/**
 * De dónde salió la credencial usada.
 *
 *  - `gym`        → el gimnasio cargó su propia API key (BYOK). Paga su consumo.
 *  - `plataforma` → no cargó ninguna, pero la plataforma tenía key del MISMO
 *                   proveedor que él eligió. Lo paga la plataforma.
 *  - `respaldo`   → ni el gym ni la plataforma tenían key para el proveedor
 *                   elegido y se degradó al de respaldo. Lo paga la plataforma y
 *                   NO es el proveedor que el gym configuró.
 */
export type FuenteCredencialIA = 'gym' | 'plataforma' | 'respaldo';

/**
 * Proveedor al que se degrada cuando no hay forma de atender al configurado.
 *
 * Es DeepSeek por costo: una rutina sale fracciones de centavo, así que sostener
 * a los gyms que todavía no cargaron su key no se vuelve caro al escalar. Además
 * ya es el default de los gyms nuevos, con lo cual la key de plataforma que exige
 * este respaldo es la misma que el alta de un tenant necesita de todos modos.
 */
export const PROVEEDOR_DE_RESPALDO: AiProvider = 'deepseek';

export interface CredencialIAResuelta {
  /** Proveedor que se va a usar REALMENTE, no necesariamente el configurado. */
  provider: AiProvider;
  apiKey: string;
  /**
   * Modelo a usar. Queda `undefined` al degradar, a propósito: el modelo que
   * configuró el gym pertenece a otro proveedor (pedir `gpt-4o` contra DeepSeek
   * falla), así que se deja que el adaptador aplique su default.
   */
  model?: string;
  fuente: FuenteCredencialIA;
}

export interface KeysDisponibles {
  /** Key propia del gym, ya descifrada. `null` si no cargó ninguna. */
  gym: string | null;
  /** Key de plataforma para el proveedor que el gym eligió. */
  plataforma: string | null;
  /** Key de plataforma para `PROVEEDOR_DE_RESPALDO`. */
  respaldo: string | null;
}

/**
 * Elige la credencial con la que se genera una rutina, en orden de preferencia:
 *
 *   1. La del gym — respeta su proveedor y su modelo.
 *   2. La de la plataforma para ESE mismo proveedor.
 *   3. La del proveedor de respaldo, cambiando de proveedor y de modelo.
 *
 * El escalón 3 existe para que un gym que todavía no cargó su key no pierda la
 * funcionalidad: antes, tener `provider = 'anthropic'` sin key propia y sin
 * `ANTHROPIC_API_KEY` en la plataforma era un 400 y la rutina no se generaba,
 * aunque la plataforma sí podía atenderlo con DeepSeek.
 *
 * Degradar es deliberadamente el ÚLTIMO recurso y no un atajo: mientras el gym o
 * la plataforma puedan servir el proveedor elegido, se usa ese, porque el dueño
 * ajustó su `promptTemplate` contra ese modelo.
 *
 * Devuelve `null` si no hay ninguna credencial utilizable. No lanza: qué error
 * corresponde es decisión del caso de uso, no de esta tabla de decisión.
 */
export const resolverCredencialIA = (
  preferido: AiProvider,
  modelPreferido: string | undefined,
  keys: KeysDisponibles
): CredencialIAResuelta | null => {
  if (keys.gym) {
    return {
      provider: preferido,
      apiKey: keys.gym,
      model: modelPreferido,
      fuente: 'gym',
    };
  }

  if (keys.plataforma) {
    return {
      provider: preferido,
      apiKey: keys.plataforma,
      model: modelPreferido,
      fuente: 'plataforma',
    };
  }

  // Si el proveedor elegido YA es el de respaldo, el escalón anterior era su
  // única chance: reintentar con la misma key daría lo mismo y marcaría como
  // degradada una generación que no lo está.
  if (preferido !== PROVEEDOR_DE_RESPALDO && keys.respaldo) {
    return {
      provider: PROVEEDOR_DE_RESPALDO,
      apiKey: keys.respaldo,
      model: undefined,
      fuente: 'respaldo',
    };
  }

  return null;
};

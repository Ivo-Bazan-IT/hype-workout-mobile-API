import { AiProvider } from '../entities/Gym';

/**
 * Patrón adaptador para proveedores de IA
 * Permite intercambio entre OpenAI y Anthropic sin tocar la lógica de negocio
 */
/**
 * Consumo reportado por el proveedor para una llamada.
 *
 * Incluye el `model` REALMENTE usado (no el pedido): cuando el gym no configura
 * uno, cada adaptador aplica su default, y medir el consumo contra un modelo
 * distinto del que se facturó haría que los números no cierren.
 */
export interface AiUsage {
  model: string;
  tokensPrompt: number;
  tokensRespuesta: number;
  tokensTotal: number;
}

export interface IAIProvider {
  /**
   * Genera una rutina a partir de un prompt YA renderizado.
   *
   * El adaptador no interpola placeholders ni conoce la encuesta: eso es regla de
   * negocio y vive en domain/prompt/promptTemplate.ts. Acá solo se habla con el SDK.
   *
   * @param params.prompt Prompt final, con los datos del cliente ya inyectados
   * @param params.model  Modelo a usar; si se omite, el adaptador aplica su default
   * @returns Contenido estructurado de la rutina y, si el proveedor lo informa, el
   *          consumo de tokens. `usage` es opcional a propósito: un proveedor puede
   *          omitirlo y eso no debe impedir que la rutina se genere.
   */
  generateRoutine(params: {
    prompt: string;
    model?: string;
  }): Promise<{ contenidoGenerado: Record<string, any>; usage?: AiUsage }>;
}

export interface AiProviderConfig {
  provider: AiProvider;
  apiKey: string;
  model?: string;
}

/**
 * Patrón adaptador para proveedores de IA
 * Permite intercambio entre OpenAI y Anthropic sin tocar la lógica de negocio
 */
export interface IAIProvider {
  /**
   * Genera una rutina de ejercicio a partir de respuestas de encuesta
   * @param params Datos de entrada para generación
   * @returns Contenido estructurado de la rutina
   */
  generateRoutine(params: {
    promptTemplate: string;
    encuestaData: Record<string, any>;
  }): Promise<{ contenidoGenerado: Record<string, any> }>;
}

export interface AiProviderConfig {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model?: string;
}
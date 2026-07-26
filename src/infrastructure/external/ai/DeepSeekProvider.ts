import OpenAI from 'openai';
import { IAIProvider, AiUsage } from '../../../domain/services/IAIProvider';
import { INSTRUCCION_FORMATO_RUTINA } from '../../../domain/prompt/promptStandard';

/**
 * Adaptador de DeepSeek.
 *
 * DeepSeek expone una API compatible con OpenAI, así que se reutiliza el SDK de
 * OpenAI apuntándolo a otro baseURL. NO es un modelo de OpenAI: usar `deepseek-chat`
 * contra api.openai.com falla, y por eso es un proveedor propio y no un `model`
 * distinto del adaptador de OpenAI.
 *
 * Es el proveedor por defecto por costo: mantiene barata la generación de rutinas
 * cuando la cantidad de clientes escala.
 */
const BASE_URL_POR_DEFECTO = 'https://api.deepseek.com/v1';
const MODELO_POR_DEFECTO = 'deepseek-chat';

export class DeepSeekProvider implements IAIProvider {
  private client: OpenAI;
  private readonly modeloPorDefecto: string;

  /**
   * `baseURL` y `modeloPorDefecto` son un PAR: apuntar a otro gateway sin cambiar
   * el modelo deja una config inconsistente. Con `DEEPSEEK_BASE_URL` en OpenRouter,
   * por ejemplo, `deepseek-chat` a secas se rechaza con 400 porque ahí los IDs
   * llevan namespace (`deepseek/deepseek-chat`). Por eso el modelo también sale de
   * env y no queda clavado al host de DeepSeek.
   */
  constructor(
    apiKey: string,
    baseURL: string = process.env.DEEPSEEK_BASE_URL || BASE_URL_POR_DEFECTO,
    modeloPorDefecto: string = process.env.DEEPSEEK_DEFAULT_MODEL || MODELO_POR_DEFECTO
  ) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.modeloPorDefecto = modeloPorDefecto;
  }

  async generateRoutine(params: {
    prompt: string;
    model?: string;
  }): Promise<{ contenidoGenerado: Record<string, any>; usage?: AiUsage }> {
    const model = params.model || this.modeloPorDefecto;

    const response = await this.client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: INSTRUCCION_FORMATO_RUTINA },
        { role: 'user', content: params.prompt }
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content ?? '{}';
    // DeepSeek puede envolver el JSON en un bloque markdown pese al response_format
    const contenidoGenerado = JSON.parse(content.replace(/```json|```/g, '').trim());

    // `usage` puede faltar según el gateway; en ese caso se omite y la medición
    // simplemente no registra esta llamada, en vez de anotar ceros falsos.
    const usage = response.usage
      ? {
          model: response.model || model,
          tokensPrompt: response.usage.prompt_tokens,
          tokensRespuesta: response.usage.completion_tokens,
          tokensTotal: response.usage.total_tokens
        }
      : undefined;

    return { contenidoGenerado, usage };
  }
}

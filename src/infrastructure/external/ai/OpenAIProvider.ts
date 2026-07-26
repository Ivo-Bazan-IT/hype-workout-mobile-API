import OpenAI from 'openai';
import { IAIProvider, AiUsage } from '../../../domain/services/IAIProvider';
import { INSTRUCCION_FORMATO_RUTINA } from '../../../domain/prompt/promptStandard';
import { traducirErrorDeIA } from './aiErrors';

const MODELO_POR_DEFECTO = 'gpt-4o-mini';

export class OpenAIProvider implements IAIProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generateRoutine(params: {
    prompt: string;
    model?: string;
  }): Promise<{ contenidoGenerado: Record<string, any>; usage?: AiUsage }> {
    const model = params.model || MODELO_POR_DEFECTO;

    const response = await this.client.chat.completions
      .create({
        model,
        messages: [
          { role: 'system', content: INSTRUCCION_FORMATO_RUTINA },
          { role: 'user', content: params.prompt }
        ],
        response_format: { type: 'json_object' },
      })
      // Traducir acá y no en el caso de uso: el vocabulario del SDK es del adaptador
      .catch((error) => {
        throw traducirErrorDeIA(error, 'openai');
      });

    const content = response.choices[0].message.content ?? '{}';
    const contenidoGenerado = JSON.parse(content);

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

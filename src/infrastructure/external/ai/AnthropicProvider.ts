import Anthropic from '@anthropic-ai/sdk';
import { IAIProvider, AiUsage } from '../../../domain/services/IAIProvider';
import { INSTRUCCION_FORMATO_RUTINA } from '../../../domain/prompt/promptStandard';
import { traducirErrorDeIA } from './aiErrors';

const MODELO_POR_DEFECTO = 'claude-3-7-sonnet-20250219';

export class AnthropicProvider implements IAIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateRoutine(params: {
    prompt: string;
    model?: string;
  }): Promise<{ contenidoGenerado: Record<string, any>; usage?: AiUsage }> {
    const model = params.model || MODELO_POR_DEFECTO;

    const response = await this.client.messages
      .create({
        model,
        max_tokens: 4000,
        system: INSTRUCCION_FORMATO_RUTINA,
        messages: [
          { role: 'user', content: params.prompt }
        ],
      })
      // Traducir acá y no en el caso de uso: el vocabulario del SDK es del adaptador
      .catch((error) => {
        throw traducirErrorDeIA(error, 'anthropic');
      });

    const content = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const contenidoGenerado = JSON.parse(content.replace(/```json|```/g, '').trim());

    // Anthropic reporta input/output por separado y no da un total: se suma acá para
    // que el puerto exponga la misma forma que el resto de los proveedores.
    const usage = response.usage
      ? {
          model: response.model || model,
          tokensPrompt: response.usage.input_tokens,
          tokensRespuesta: response.usage.output_tokens,
          tokensTotal: response.usage.input_tokens + response.usage.output_tokens
        }
      : undefined;

    return { contenidoGenerado, usage };
  }
}

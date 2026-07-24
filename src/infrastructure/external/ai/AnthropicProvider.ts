import Anthropic from '@anthropic-ai/sdk';
import { IAIProvider } from '../../../domain/services/IAIProvider';

export class AnthropicProvider implements IAIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateRoutine(params: {
    promptTemplate: string;
    encuestaData: Record<string, any>;
  }): Promise<{ contenidoGenerado: Record<string, any> }> {
    const finalPrompt = params.promptTemplate.replace(
      '{{respuestas_encuesta}}',
      JSON.stringify(params.encuestaData, null, 2)
    );

    const response = await this.client.messages.create({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 4000,
      system: 'Devolvé únicamente un JSON válido con la estructura de rutina solicitada, sin texto adicional.',
      messages: [
        { role: 'user', content: finalPrompt }
      ],
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const contenidoGenerado = JSON.parse(content.replace(/```json|```/g, '').trim());

    return { contenidoGenerado };
  }
}
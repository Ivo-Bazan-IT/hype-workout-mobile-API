import OpenAI from 'openai';
import { IAIProvider } from '../../../domain/services/IAIProvider';

export class OpenAIProvider implements IAIProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generateRoutine(params: {
    promptTemplate: string;
    encuestaData: Record<string, any>;
  }): Promise<{ contenidoGenerado: Record<string, any> }> {
    const finalPrompt = params.promptTemplate.replace(
      '{{respuestas_encuesta}}',
      JSON.stringify(params.encuestaData, null, 2)
    );

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Devolvé únicamente un JSON válido con la estructura de rutina solicitada, sin texto adicional.'
        },
        { role: 'user', content: finalPrompt }
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content ?? '{}';
    const contenidoGenerado = JSON.parse(content);

    return { contenidoGenerado };
  }
}
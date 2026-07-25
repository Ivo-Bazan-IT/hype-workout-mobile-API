import { describe, it, expect } from 'vitest';
import { AIProviderFactory } from '../../../src/infrastructure/external/ai/AIProviderFactory';
import { DeepSeekProvider } from '../../../src/infrastructure/external/ai/DeepSeekProvider';
import { OpenAIProvider } from '../../../src/infrastructure/external/ai/OpenAIProvider';
import { AnthropicProvider } from '../../../src/infrastructure/external/ai/AnthropicProvider';
import { AI_PROVIDERS } from '../../../src/domain/entities/Gym';

describe('AIProviderFactory', () => {
  const factory = new AIProviderFactory();

  it('devuelve el adaptador de DeepSeek', () => {
    expect(factory.create('deepseek', 'sk-test')).toBeInstanceOf(DeepSeekProvider);
  });

  it('devuelve el adaptador de OpenAI', () => {
    expect(factory.create('openai', 'sk-test')).toBeInstanceOf(OpenAIProvider);
  });

  it('devuelve el adaptador de Anthropic', () => {
    expect(factory.create('anthropic', 'sk-test')).toBeInstanceOf(AnthropicProvider);
  });

  it('cubre todos los proveedores declarados en el dominio', () => {
    // Si se agrega uno a AI_PROVIDERS y se olvida el case del switch, esto falla
    for (const provider of AI_PROVIDERS) {
      expect(() => factory.create(provider, 'sk-test')).not.toThrow();
    }
  });

  it('rechaza un proveedor desconocido', () => {
    expect(() => factory.create('gemini' as any, 'sk-test')).toThrow('Unknown AI provider: gemini');
  });
});

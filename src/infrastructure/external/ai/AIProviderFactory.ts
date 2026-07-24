import { IAIProvider } from '../../../domain/services/IAIProvider';
import { IAIProviderFactory } from '../../../domain/services/IAIProviderFactory';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';

export class AIProviderFactory implements IAIProviderFactory {
  create(provider: 'openai' | 'anthropic', apiKey: string): IAIProvider {
    switch (provider) {
      case 'openai':
        return new OpenAIProvider(apiKey);
      case 'anthropic':
        return new AnthropicProvider(apiKey);
      default:
        throw new Error(`Unknown AI provider: ${provider}`);
    }
  }
}

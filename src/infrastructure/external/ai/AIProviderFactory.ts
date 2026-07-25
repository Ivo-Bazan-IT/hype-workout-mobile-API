import { IAIProvider } from '../../../domain/services/IAIProvider';
import { IAIProviderFactory } from '../../../domain/services/IAIProviderFactory';
import { AiProvider } from '../../../domain/entities/Gym';
import { DeepSeekProvider } from './DeepSeekProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';

export class AIProviderFactory implements IAIProviderFactory {
  create(provider: AiProvider, apiKey: string): IAIProvider {
    switch (provider) {
      case 'deepseek':
        return new DeepSeekProvider(apiKey);
      case 'openai':
        return new OpenAIProvider(apiKey);
      case 'anthropic':
        return new AnthropicProvider(apiKey);
      default:
        throw new Error(`Unknown AI provider: ${provider}`);
    }
  }
}

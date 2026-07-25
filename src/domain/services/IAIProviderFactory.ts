import { IAIProvider } from './IAIProvider';
import { AiProvider } from '../entities/Gym';

/**
 * Fábrica de proveedores de IA. Permite a los casos de uso obtener un IAIProvider
 * configurado por-gym (según provider + API key del tenant) sin instanciar
 * infraestructura concreta ni conocer OpenAI/Anthropic.
 */
export interface IAIProviderFactory {
  create(provider: AiProvider, apiKey: string): IAIProvider;
}

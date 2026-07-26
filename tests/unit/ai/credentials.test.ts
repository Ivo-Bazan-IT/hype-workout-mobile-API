import { describe, it, expect } from 'vitest';
import {
  PROVEEDOR_DE_RESPALDO,
  resolverCredencialIA,
} from '../../../src/domain/ai/credentials';

const sinKeys = { gym: null, plataforma: null, respaldo: null };

describe('resolverCredencialIA', () => {
  it('prioriza la key del gym y respeta su proveedor y su modelo', () => {
    const cred = resolverCredencialIA('anthropic', 'claude-3-7-sonnet-20250219', {
      gym: 'sk-del-gym',
      plataforma: 'sk-de-plataforma',
      respaldo: 'sk-deepseek',
    });

    expect(cred).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-del-gym',
      model: 'claude-3-7-sonnet-20250219',
      fuente: 'gym',
    });
  });

  it('usa la key de plataforma del mismo proveedor si el gym no cargó la suya', () => {
    const cred = resolverCredencialIA('openai', 'gpt-4o', {
      ...sinKeys,
      plataforma: 'sk-de-plataforma',
      respaldo: 'sk-deepseek',
    });

    // Sigue siendo el proveedor que el gym eligió: no hay degradación acá
    expect(cred).toEqual({
      provider: 'openai',
      apiKey: 'sk-de-plataforma',
      model: 'gpt-4o',
      fuente: 'plataforma',
    });
  });

  it('degrada al proveedor de respaldo cuando nadie puede servir el elegido', () => {
    const cred = resolverCredencialIA('anthropic', 'claude-3-7-sonnet-20250219', {
      ...sinKeys,
      respaldo: 'sk-deepseek',
    });

    expect(cred?.provider).toBe(PROVEEDOR_DE_RESPALDO);
    expect(cred?.apiKey).toBe('sk-deepseek');
    expect(cred?.fuente).toBe('respaldo');
  });

  it('descarta el modelo del gym al degradar, porque es de otro proveedor', () => {
    const cred = resolverCredencialIA('openai', 'gpt-4o', {
      ...sinKeys,
      respaldo: 'sk-deepseek',
    });

    // Pedirle `gpt-4o` a DeepSeek falla: se deja que el adaptador ponga su default
    expect(cred?.model).toBeUndefined();
  });

  it('no marca como degradada una generación del propio proveedor de respaldo', () => {
    const cred = resolverCredencialIA(PROVEEDOR_DE_RESPALDO, undefined, {
      ...sinKeys,
      plataforma: 'sk-deepseek',
      respaldo: 'sk-deepseek',
    });

    // Es la misma key: llamarlo 'respaldo' inventaría una degradación inexistente
    expect(cred?.fuente).toBe('plataforma');
  });

  it('devuelve null si el proveedor de respaldo tampoco tiene key', () => {
    expect(resolverCredencialIA('openai', 'gpt-4o', sinKeys)).toBeNull();
  });

  it('devuelve null si el gym eligió el proveedor de respaldo y no hay ninguna key', () => {
    expect(resolverCredencialIA(PROVEEDOR_DE_RESPALDO, undefined, sinKeys)).toBeNull();
  });
});

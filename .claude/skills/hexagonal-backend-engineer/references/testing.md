# Testing (Vitest) en este proyecto

Los tests viven en `tests/unit/<feature>/XUseCase.test.ts` y prueban **casos de uso en aislamiento**:
los puertos se mockean con `vi.fn()` y se pasan como `any`. No se toca la base de datos ni Express.
Esta es la ventaja concreta de la arquitectura hexagonal aquí — la lógica se prueba sin infraestructura.

Comando: `npm test` (equivale a `vitest run`). Config en `vitest.config.ts`, setup en `tests/setup.ts`.

> **Dependencia de entorno a tener presente.** `tests/setup.ts` conecta a MongoDB
> (`mongodb://localhost:27017/...`) en un `beforeAll` **global**, de modo que el suite completo exige
> un Mongo vivo aunque los unit tests de casos de uso solo usan mocks y no tocan la DB. Si Mongo no
> está corriendo, el suite expira por timeout sin ejecutar nada. Cuando eso pase, no bloquees la
> tarea: valida con `npx tsc --noEmit` + `npm run lint` y verifica que tu test está bien escrito.
> (Este acoplamiento de tests unitarios rápidos a una DB viva es, de hecho, un hallazgo legítimo para
> una auditoría — ver `audit-refactor.md`.)

## Patrón de test de caso de uso

Sigue exactamente esta forma (extraída de `tests/unit/client/SearchClientsUseCase.test.ts`):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CreateMembershipUseCase } from '../../../src/application/use-cases/membership/CreateMembershipUseCase';

describe('CreateMembershipUseCase', () => {
  it('creates a membership when the client exists and has no active one', async () => {
    const mockMembershipRepo = {
      findByClient: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'mem-1', estado: 'activa' }),
    } as any;
    const mockClientRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'client-1', gymId: 'gym-1' }),
    } as any;

    const useCase = new CreateMembershipUseCase(mockMembershipRepo, mockClientRepo);

    const result = await useCase.execute({
      gymId: 'gym-1',
      clientId: 'client-1',
      plan: 'mensual',
      precio: 5000,
      fechaInicio: new Date(),
      fechaFin: new Date(),
    });

    expect(mockClientRepo.findById).toHaveBeenCalledWith('client-1', 'gym-1');
    expect(mockMembershipRepo.create).toHaveBeenCalled();
    expect(result.id).toBe('mem-1');
  });

  it('throws NotFoundError when the client does not exist', async () => {
    const mockMembershipRepo = { findByClient: vi.fn(), create: vi.fn() } as any;
    const mockClientRepo = { findById: vi.fn().mockResolvedValue(null) } as any;

    const useCase = new CreateMembershipUseCase(mockMembershipRepo, mockClientRepo);

    await expect(
      useCase.execute({
        gymId: 'gym-1',
        clientId: 'missing',
        plan: 'mensual',
        precio: 5000,
        fechaInicio: new Date(),
        fechaFin: new Date(),
      })
    ).rejects.toThrow('Client not found');
  });
});
```

## Qué cubrir

- **El camino feliz**: verifica que se llamó al puerto correcto con los argumentos correctos
  (incluido `gymId`) y que el resultado se propaga.
- **Cada rama de invariante de negocio**: por cada `throw` en el caso de uso, un test que lo dispara
  y comprueba con `rejects.toThrow(...)`. Los mensajes de error vienen de las clases de
  `shared/errors/AppError` (p. ej. `NotFoundError('Client')` → `'Client not found'`).
- **Aislamiento multi-tenant**: cuando aplique, verifica que el `gymId` se pasa hacia el repositorio.

No hace falta testear controllers ni repos Mongo con unit tests — la política del repo es probar la
lógica (casos de uso). Si el proyecto añade tests de integración con Supertest más adelante, seguir
ese patrón, pero no es lo que se espera por defecto para un caso de uso nuevo.

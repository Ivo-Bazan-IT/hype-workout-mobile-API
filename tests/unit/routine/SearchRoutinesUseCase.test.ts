import { describe, it, expect, vi } from 'vitest';
import { SearchRoutinesUseCase } from '../../../src/application/use-cases/routine/SearchRoutinesUseCase';

const vacio = {
  data: [],
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
};

const makeUseCase = (
  search = vi.fn().mockResolvedValue(vacio)
): { useCase: SearchRoutinesUseCase; search: ReturnType<typeof vi.fn> } => {
  const routineRepository = { search } as any;
  return { useCase: new SearchRoutinesUseCase(routineRepository), search };
};

describe('SearchRoutinesUseCase', () => {
  it('pasa el gym y los filtros al puerto', async () => {
    const { useCase, search } = makeUseCase();

    await useCase.execute({
      gymId: 'gym-1',
      filters: { estadoEnvio: 'pendiente', clientId: 'client-1' },
      page: 2,
      limit: 50,
    });

    expect(search).toHaveBeenCalledWith(
      'gym-1',
      { estadoEnvio: 'pendiente', clientId: 'client-1' },
      2,
      50
    );
  });

  it('devuelve el resultado paginado tal como viene del puerto', async () => {
    const fila = {
      id: 'routine-1',
      clientId: 'client-1',
      clientNombre: 'Iván Bazán',
      estadoEnvio: 'pendiente',
    };
    const { useCase } = makeUseCase(
      vi.fn().mockResolvedValue({ ...vacio, data: [fila], total: 1, totalPages: 1 })
    );

    const result = await useCase.execute({ gymId: 'gym-1', filters: {} });

    // El nombre del socio viaja en la fila: sin él la pantalla vuelve a cruzar cada
    // rutina contra un padrón cacheado, que es el cruce que se borró una vez.
    expect(result.data[0].clientNombre).toBe('Iván Bazán');
    expect(result.total).toBe(1);
  });

  it('usa página 1 y 20 por defecto', async () => {
    const { useCase, search } = makeUseCase();

    await useCase.execute({ gymId: 'gym-1', filters: {} });

    expect(search).toHaveBeenCalledWith('gym-1', {}, 1, 20);
  });

  it('corta el limit en 100 para que un ?limit=100000 no traiga el historial entero', async () => {
    const { useCase, search } = makeUseCase();

    await useCase.execute({ gymId: 'gym-1', filters: {}, limit: 100000 });

    expect(search).toHaveBeenCalledWith('gym-1', {}, 1, 100);
  });

  it('no acepta páginas ni límites por debajo de 1', async () => {
    const { useCase, search } = makeUseCase();

    await useCase.execute({ gymId: 'gym-1', filters: {}, page: 0, limit: -5 });

    expect(search).toHaveBeenCalledWith('gym-1', {}, 1, 1);
  });

  it('rechaza un rango de vencimiento invertido', async () => {
    const { useCase } = makeUseCase();

    await expect(
      useCase.execute({
        gymId: 'gym-1',
        filters: {
          vencimientoDesde: new Date('2026-06-01'),
          vencimientoHasta: new Date('2026-05-01'),
        },
      })
    ).rejects.toThrow('vencimientoDesde cannot be later than vencimientoHasta');
  });
});

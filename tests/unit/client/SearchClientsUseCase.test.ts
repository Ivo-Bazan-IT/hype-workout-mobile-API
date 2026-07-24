import { describe, it, expect, vi } from 'vitest';
import { SearchClientsUseCase } from '../../../src/application/use-cases/client/SearchClientsUseCase';

describe('SearchClientsUseCase', () => {
  it('should search clients with filters', async () => {
    const mockSearch = vi.fn().mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0
    });

    const mockRepo = {
      search: mockSearch
    } as any;

    const useCase = new SearchClientsUseCase(mockRepo);

    const result = await useCase.execute({
      gymId: 'gym-123',
      filters: {
        query: 'test',
        estado: 'activo'
      },
      page: 1,
      limit: 10
    });

    expect(mockSearch).toHaveBeenCalledWith(
      'gym-123',
      { query: 'test', estado: 'activo' },
      1,
      10
    );
    expect(result.total).toBe(0);
  });

  it('should use default pagination values', async () => {
    const mockSearch = vi.fn().mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0
    });

    const mockRepo = {
      search: mockSearch
    } as any;

    const useCase = new SearchClientsUseCase(mockRepo);

    await useCase.execute({
      gymId: 'gym-123',
      filters: {},
      page: 1,
      limit: 20
    });

    expect(mockSearch).toHaveBeenCalled();
  });
});
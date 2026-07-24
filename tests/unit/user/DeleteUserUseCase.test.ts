import { describe, it, expect, vi } from 'vitest';
import { DeleteUserUseCase } from '../../../src/application/use-cases/user/DeleteUserUseCase';

describe('DeleteUserUseCase', () => {
  it('soft deletes the user by setting isActive to false', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'user-1', role: 'gym', gymId: 'gym-1' }),
      update: vi.fn().mockResolvedValue({ id: 'user-1', isActive: false }),
    } as any;

    const useCase = new DeleteUserUseCase(mockUserRepo);

    await useCase.execute({ userId: 'user-1' });

    expect(mockUserRepo.update).toHaveBeenCalledWith('user-1', { isActive: false });
  });

  it('throws NotFoundError when the user does not exist', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    } as any;

    const useCase = new DeleteUserUseCase(mockUserRepo);

    await expect(useCase.execute({ userId: 'missing' })).rejects.toThrow('User not found');
    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });

  it('refuses to deactivate an admin user', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'admin', gymId: null }),
      update: vi.fn(),
    } as any;

    const useCase = new DeleteUserUseCase(mockUserRepo);

    await expect(useCase.execute({ userId: 'admin-1' })).rejects.toThrow(
      'Only gym owner users can be managed from this endpoint'
    );
    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });
});

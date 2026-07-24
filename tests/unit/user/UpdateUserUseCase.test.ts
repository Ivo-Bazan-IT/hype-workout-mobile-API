import { describe, it, expect, vi } from 'vitest';
import { UpdateUserUseCase } from '../../../src/application/use-cases/user/UpdateUserUseCase';

const gymUser = {
  id: 'user-1',
  email: 'dueño@gym.com',
  name: 'Dueño',
  role: 'gym',
  gymId: 'gym-1',
  isActive: true,
};

describe('UpdateUserUseCase', () => {
  it('updates name and isActive of a gym owner user', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue(gymUser),
      findByEmail: vi.fn(),
      update: vi.fn().mockResolvedValue({ ...gymUser, name: 'Nuevo Nombre', isActive: false }),
    } as any;
    const mockGymRepo = { findById: vi.fn() } as any;

    const useCase = new UpdateUserUseCase(mockUserRepo, mockGymRepo);

    const result = await useCase.execute({
      userId: 'user-1',
      name: 'Nuevo Nombre',
      isActive: false,
    });

    expect(mockUserRepo.update).toHaveBeenCalledWith('user-1', {
      email: undefined,
      name: 'Nuevo Nombre',
      isActive: false,
      gymId: undefined,
    });
    expect(result.name).toBe('Nuevo Nombre');
    expect(result.isActive).toBe(false);
  });

  it('throws ForbiddenError when the target user is an admin', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue({ ...gymUser, role: 'admin', gymId: null }),
      update: vi.fn(),
    } as any;
    const mockGymRepo = { findById: vi.fn() } as any;

    const useCase = new UpdateUserUseCase(mockUserRepo, mockGymRepo);

    await expect(useCase.execute({ userId: 'user-1', name: 'Hack' })).rejects.toThrow(
      'Only gym owner users can be managed from this endpoint'
    );

    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the new email belongs to another user', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue(gymUser),
      findByEmail: vi.fn().mockResolvedValue({ id: 'user-2' }),
      update: vi.fn(),
    } as any;
    const mockGymRepo = { findById: vi.fn() } as any;

    const useCase = new UpdateUserUseCase(mockUserRepo, mockGymRepo);

    await expect(
      useCase.execute({ userId: 'user-1', email: 'otro@gym.com' })
    ).rejects.toThrow('A user with this email already exists');

    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when reassigning to a gym that does not exist', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue(gymUser),
      findByEmail: vi.fn(),
      update: vi.fn(),
    } as any;
    const mockGymRepo = { findById: vi.fn().mockResolvedValue(null) } as any;

    const useCase = new UpdateUserUseCase(mockUserRepo, mockGymRepo);

    await expect(
      useCase.execute({ userId: 'user-1', gymId: 'gym-inexistente' })
    ).rejects.toThrow('Gym not found');

    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { CreateUserUseCase } from '../../../src/application/use-cases/user/CreateUserUseCase';

describe('CreateUserUseCase', () => {
  it('creates a gym owner user with a hashed password', async () => {
    const mockUserRepo = {
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((user) => Promise.resolve({ id: 'user-1', ...user })),
    } as any;
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'gym-1', name: 'Hype Workout' }),
    } as any;

    const useCase = new CreateUserUseCase(mockUserRepo, mockGymRepo);

    const result = await useCase.execute({
      email: 'dueño@gym.com',
      password: 'secret123',
      name: 'Dueño',
      gymId: 'gym-1',
    });

    expect(mockGymRepo.findById).toHaveBeenCalledWith('gym-1');
    expect(result.role).toBe('gym');
    expect(result.gymId).toBe('gym-1');
    expect(result.isActive).toBe(true);
    // La contraseña nunca se persiste en claro
    expect(result.passwordHash).not.toBe('secret123');
    expect(result.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('throws NotFoundError when the gym does not exist', async () => {
    const mockUserRepo = { findByEmail: vi.fn(), create: vi.fn() } as any;
    const mockGymRepo = { findById: vi.fn().mockResolvedValue(null) } as any;

    const useCase = new CreateUserUseCase(mockUserRepo, mockGymRepo);

    await expect(
      useCase.execute({
        email: 'dueño@gym.com',
        password: 'secret123',
        name: 'Dueño',
        gymId: 'missing',
      })
    ).rejects.toThrow('Gym not found');

    expect(mockUserRepo.create).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the email is already taken', async () => {
    const mockUserRepo = {
      findByEmail: vi.fn().mockResolvedValue({ id: 'user-existing' }),
      create: vi.fn(),
    } as any;
    const mockGymRepo = { findById: vi.fn().mockResolvedValue({ id: 'gym-1' }) } as any;

    const useCase = new CreateUserUseCase(mockUserRepo, mockGymRepo);

    await expect(
      useCase.execute({
        email: 'tomado@gym.com',
        password: 'secret123',
        name: 'Dueño',
        gymId: 'gym-1',
      })
    ).rejects.toThrow('A user with this email already exists');

    expect(mockUserRepo.create).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { RefreshTokenUseCase } from '../../../src/application/use-cases/auth/RefreshTokenUseCase';
import { env } from '../../../src/config/env';

const activeUser = {
  id: 'user-1',
  email: 'dueño@gym.com',
  name: 'Dueño',
  role: 'gym' as const,
  gymId: 'gym-1',
  isActive: true,
};

const signRefreshToken = (userId: string) =>
  jwt.sign({ userId }, env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

describe('RefreshTokenUseCase', () => {
  // Esta es la regresión que deslogueaba al recargar la página: el caso de uso
  // devolvía solo el accessToken, el front armaba la sesión con un `user`
  // undefined y, como la respuesta era 200, nadie tiraba error. F5 rebotaba al
  // login con un refresh exitoso.
  it('returns the user alongside the new access token', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue(activeUser),
    } as any;

    const useCase = new RefreshTokenUseCase(mockUserRepo);

    const result = await useCase.execute(signRefreshToken('user-1'));

    expect(mockUserRepo.findById).toHaveBeenCalledWith('user-1');
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'dueño@gym.com',
      name: 'Dueño',
      role: 'gym',
      gymId: 'gym-1',
    });
  });

  it('issues an access token carrying the tenant claims', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue(activeUser),
    } as any;

    const useCase = new RefreshTokenUseCase(mockUserRepo);

    const { accessToken } = await useCase.execute(signRefreshToken('user-1'));

    const decoded = jwt.verify(accessToken, env.JWT_ACCESS_SECRET) as any;
    expect(decoded.userId).toBe('user-1');
    expect(decoded.role).toBe('gym');
    // Sin gymId en el claim, el resto de la API no sabe de qué tenant es el request
    expect(decoded.gymId).toBe('gym-1');
  });

  it('nunca expone el passwordHash aunque el repositorio lo traiga', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue({ ...activeUser, passwordHash: '$2b$10$hash' }),
    } as any;

    const useCase = new RefreshTokenUseCase(mockUserRepo);

    const result = await useCase.execute(signRefreshToken('user-1'));

    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const mockUserRepo = { findById: vi.fn() } as any;
    const useCase = new RefreshTokenUseCase(mockUserRepo);

    const forged = jwt.sign({ userId: 'user-1' }, 'not-the-refresh-secret');

    await expect(useCase.execute(forged)).rejects.toThrow('Invalid or expired refresh token');
    expect(mockUserRepo.findById).not.toHaveBeenCalled();
  });

  it('rejects an expired refresh token', async () => {
    const mockUserRepo = { findById: vi.fn() } as any;
    const useCase = new RefreshTokenUseCase(mockUserRepo);

    const expired = jwt.sign({ userId: 'user-1' }, env.JWT_REFRESH_SECRET, { expiresIn: '-1s' });

    await expect(useCase.execute(expired)).rejects.toThrow('Invalid or expired refresh token');
  });

  it('rejects a deactivated user even with a valid token', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue({ ...activeUser, isActive: false }),
    } as any;

    const useCase = new RefreshTokenUseCase(mockUserRepo);

    await expect(useCase.execute(signRefreshToken('user-1'))).rejects.toThrow(
      'Invalid or expired refresh token'
    );
  });

  it('rejects a token whose user no longer exists', async () => {
    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue(null),
    } as any;

    const useCase = new RefreshTokenUseCase(mockUserRepo);

    await expect(useCase.execute(signRefreshToken('ghost'))).rejects.toThrow(
      'Invalid or expired refresh token'
    );
  });
});

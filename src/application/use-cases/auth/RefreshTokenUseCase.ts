import jwt from 'jsonwebtoken';
import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { env } from '../../../config/env';
import { UnauthorizedError } from '../../../shared/errors/AppError';

export class RefreshTokenUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(refreshToken: string): Promise<{ accessToken: string }> {
    try {
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { userId: string };

      const user = await this.userRepository.findById(decoded.userId);

      if (!user || !user.isActive) {
        throw new UnauthorizedError('Invalid refresh token');
      }

      const newAccessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
          gymId: user.gymId,
        },
        env.JWT_ACCESS_SECRET,
        { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as any
      );

      return { accessToken: newAccessToken };
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
  }
}
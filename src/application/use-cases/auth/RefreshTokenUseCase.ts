import jwt from 'jsonwebtoken';
import { IUserRepository } from '../../../domain/repositories/IUserRepository';
import { env } from '../../../config/env';
import { UnauthorizedError } from '../../../shared/errors/AppError';

/*
 * Misma forma que devuelve LoginUseCase (sin el refreshToken, que sigue viviendo
 * en la cookie httpOnly y acá no se rota). El `user` no es decorativo: al recargar
 * la página el front no tiene nada en memoria y arma la sesión con lo que conteste
 * este endpoint. Devolver solo el accessToken dejaba `user` en undefined, y como
 * la respuesta era 200 nadie tiraba error: PrivateRoute veía la sesión vacía y
 * rebotaba al login. F5 te deslogueaba con un refresh exitoso.
 */
interface RefreshResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'gym';
    gymId?: string | null;
  };
}

export class RefreshTokenUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(refreshToken: string): Promise<RefreshResponse> {
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

      return {
        accessToken: newAccessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          gymId: user.gymId,
        },
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
  }
}
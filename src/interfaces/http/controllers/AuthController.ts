import { Request, Response, NextFunction } from 'express';
import { LoginUseCase } from '../../../application/use-cases/auth/LoginUseCase';
import { RefreshTokenUseCase } from '../../../application/use-cases/auth/RefreshTokenUseCase';
import { loginSchema } from '../validators/gym.validator';

export class AuthController {
  constructor(
    private loginUseCase: LoginUseCase,
    private refreshUseCase: RefreshTokenUseCase
  ) {}

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = loginSchema.parse(req.body);
      const result = await this.loginUseCase.execute(validated);

      // Set refresh token as httpOnly cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.json({
        status: 'success',
        data: {
          accessToken: result.accessToken,
          user: result.user,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = req.cookies.refreshToken;

      if (!refreshToken) {
        res.status(401).json({
          status: 'error',
          message: 'Refresh token not found'
        });
        return;
      }

      const result = await this.refreshUseCase.execute(refreshToken);

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // El usuario ya está en el request por authMiddleware
      const user = (req as any).user;

      res.json({
        status: 'success',
        data: {
          email: user.email,
          role: user.role,
          gymId: user.gymId,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(_req: Request, res: Response, _next: NextFunction): Promise<void> {
    // En JWT sin sessions, el logout es solo borrar el cookie del cliente
    // El refresh token queda "invalidado" cuando se usa uno nuevo
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    res.json({
      status: 'success',
      message: 'Logged out successfully'
    });
  }
}
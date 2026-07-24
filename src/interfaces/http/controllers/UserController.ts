import { Response, NextFunction } from 'express';
import { CreateUserUseCase } from '../../../application/use-cases/user/CreateUserUseCase';
import { ListUsersUseCase } from '../../../application/use-cases/user/ListUsersUseCase';
import { GetUserUseCase } from '../../../application/use-cases/user/GetUserUseCase';
import { UpdateUserUseCase } from '../../../application/use-cases/user/UpdateUserUseCase';
import { DeleteUserUseCase } from '../../../application/use-cases/user/DeleteUserUseCase';
import { ResetUserPasswordUseCase } from '../../../application/use-cases/user/ResetUserPasswordUseCase';
import { User, UserRole } from '../../../domain/entities/User';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

/**
 * Allowlist explícito de la respuesta: `passwordHash` nunca sale por HTTP.
 * Mismo criterio que GET /api/gyms/settings con los secretos del gym.
 */
const toUserResponse = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  gymId: user.gymId ?? null,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export class UserController {
  constructor(
    private createUserUseCase: CreateUserUseCase,
    private listUsersUseCase: ListUsersUseCase,
    private getUserUseCase: GetUserUseCase,
    private updateUserUseCase: UpdateUserUseCase,
    private deleteUserUseCase: DeleteUserUseCase,
    private resetUserPasswordUseCase: ResetUserPasswordUseCase
  ) {}

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await this.createUserUseCase.execute(req.body);

      res.status(201).json({
        status: 'success',
        data: toUserResponse(user)
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.listUsersUseCase.execute({
        filters: {
          query: req.query.q as string | undefined,
          role: req.query.role as UserRole | undefined,
          gymId: req.query.gymId as string | undefined,
          isActive: req.query.isActive as boolean | undefined
        },
        page: req.query.page as unknown as number,
        limit: req.query.limit as unknown as number
      });

      res.json({
        status: 'success',
        data: {
          ...result,
          data: result.data.map(toUserResponse)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const user = await this.getUserUseCase.execute({ userId: id });

      res.json({
        status: 'success',
        data: toUserResponse(user)
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const user = await this.updateUserUseCase.execute({
        userId: id,
        ...req.body
      });

      res.json({
        status: 'success',
        data: toUserResponse(user)
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      await this.deleteUserUseCase.execute({ userId: id });

      res.json({
        status: 'success',
        message: 'User deactivated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { password } = req.body;

      await this.resetUserPasswordUseCase.execute({ userId: id, password });

      res.json({
        status: 'success',
        message: 'Password updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

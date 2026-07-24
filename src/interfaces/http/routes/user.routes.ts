import { Router } from 'express';
import { MongoUserRepository } from '../../../infrastructure/database/mongoose/repositories/MongoUserRepository';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { CreateUserUseCase } from '../../../application/use-cases/user/CreateUserUseCase';
import { ListUsersUseCase } from '../../../application/use-cases/user/ListUsersUseCase';
import { GetUserUseCase } from '../../../application/use-cases/user/GetUserUseCase';
import { UpdateUserUseCase } from '../../../application/use-cases/user/UpdateUserUseCase';
import { DeleteUserUseCase } from '../../../application/use-cases/user/DeleteUserUseCase';
import { ResetUserPasswordUseCase } from '../../../application/use-cases/user/ResetUserPasswordUseCase';
import { UserController } from '../controllers/UserController';
import {
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  searchUsersSchema
} from '../validators/user.validator';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

// Middleware para validar query params
function validateQuery(schema: z.ZodSchema<any>) {
  return (req: any, _res: any, next: any) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Middleware para validar body con Zod
function validateBody(schema: z.ZodSchema<any>) {
  return (req: any, _res: any, next: any) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const createAdminUserRoutes = () => {
  const router = Router();

  // Adaptadores concretos: ÚNICO lugar donde se instancia infraestructura
  const userRepository = new MongoUserRepository();
  const gymRepository = new MongoGymRepository();

  // Casos de uso: reciben solo puertos
  const createUserUseCase = new CreateUserUseCase(userRepository, gymRepository);
  const listUsersUseCase = new ListUsersUseCase(userRepository);
  const getUserUseCase = new GetUserUseCase(userRepository);
  const updateUserUseCase = new UpdateUserUseCase(userRepository, gymRepository);
  const deleteUserUseCase = new DeleteUserUseCase(userRepository);
  const resetUserPasswordUseCase = new ResetUserPasswordUseCase(userRepository);

  const userController = new UserController(
    createUserUseCase,
    listUsersUseCase,
    getUserUseCase,
    updateUserUseCase,
    deleteUserUseCase,
    resetUserPasswordUseCase
  );

  // GET /api/admin/users - Listar usuarios (paginado + filtros)
  router.get('/', validateQuery(searchUsersSchema), (req, res, next) =>
    userController.list(req as AuthenticatedRequest, res, next)
  );

  // GET /api/admin/users/search - Alias explícito de búsqueda.
  // Declarado ANTES de /:id para que no lo capture el parámetro dinámico.
  router.get('/search', validateQuery(searchUsersSchema), (req, res, next) =>
    userController.list(req as AuthenticatedRequest, res, next)
  );

  // GET /api/admin/users/:id - Obtener un usuario
  router.get('/:id', (req, res, next) =>
    userController.get(req as AuthenticatedRequest, res, next)
  );

  // POST /api/admin/users - Crear usuario dueño de gym
  router.post('/', validateBody(createUserSchema), (req, res, next) =>
    userController.create(req as AuthenticatedRequest, res, next)
  );

  // PUT /api/admin/users/:id - Actualizar usuario
  router.put('/:id', validateBody(updateUserSchema), (req, res, next) =>
    userController.update(req as AuthenticatedRequest, res, next)
  );

  // DELETE /api/admin/users/:id - Desactivar usuario (soft delete)
  router.delete('/:id', (req, res, next) =>
    userController.delete(req as AuthenticatedRequest, res, next)
  );

  // PUT /api/admin/users/:id/password - Reset de contraseña por el super-admin
  router.put('/:id/password', validateBody(resetUserPasswordSchema), (req, res, next) =>
    userController.resetPassword(req as AuthenticatedRequest, res, next)
  );

  return router;
};

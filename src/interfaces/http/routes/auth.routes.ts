import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { LoginUseCase } from '../../../application/use-cases/auth/LoginUseCase';
import { RefreshTokenUseCase } from '../../../application/use-cases/auth/RefreshTokenUseCase';
import { MongoUserRepository } from '../../../infrastructure/database/mongoose/repositories/MongoUserRepository';
import { authMiddleware } from '../middlewares/authMiddleware';
import rateLimit from 'express-rate-limit';

const createAuthRouter = () => {
  const router = Router();
  const userRepository = new MongoUserRepository();
  const loginUseCase = new LoginUseCase(userRepository);
  const refreshUseCase = new RefreshTokenUseCase(userRepository);
  const authController = new AuthController(loginUseCase, refreshUseCase);

  // Rate limiting para prevenir brute force
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // máximo 5 intentos por IP
    message: 'Too many authentication attempts, please try again later',
  });

  router.post('/login', authLimiter, (req, res, next) => authController.login(req, res, next));
  router.post('/refresh', (req, res, next) => authController.refresh(req, res, next));
  router.post('/logout', (req, res, next) => authController.logout(req, res, next));
  // Este router se monta ANTES del authMiddleware global (login/refresh/logout son
  // públicos), así que /me necesita aplicarlo explícitamente: sin esto req.user
  // llega undefined y el handler revienta con 500 en vez de responder 401.
  router.get('/me', authMiddleware, (req, res, next) => authController.me(req, res, next));

  return router;
};

export const authRoutes = createAuthRouter();
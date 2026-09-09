import { Router } from 'express';
import { authRoutes } from './auth.routes';
import { gymRoutes, adminGymRoutes } from './gym.routes';
import { onboardingRoutes, onboardingStatusRoutes } from './onboarding.routes';
import { routineRoutes } from './routine.routes';
import { createClientRoutes } from './client.routes';
import { createCheckInRoutes } from './checkin.routes';
import { createInvoiceRoutes } from './invoice.routes';
import { createAiUsageRoutes } from './aiUsage.routes';
import { createDashboardRouter } from './dashboard.routes';
import { createAdminUserRoutes } from './user.routes';
import { internalRoutes } from './internal.routes';
import { mercadoPagoPublicRoutes } from './mercadopago.routes';
import { UpdateClienteEntrenadorUseCase } from '../../../application/use-cases/user/UpdateClienteEntrenadorUseCase';
import { MongoUserRepository } from '../../../infrastructure/database/mongoose/repositories/MongoUserRepository';
import { authMiddleware } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { requireAdmin } from '../middlewares/roleMiddleware';

const router = Router();

// Public routes
router.use('/auth', authRoutes);
// Solo el webhook: lo llama Google, que no tiene JWT. El resto de /onboarding se
// monta más abajo, detrás de la autenticación.
router.use('/onboarding', onboardingRoutes);
// Disparadores internos: los llama nuestro cron externo, que tampoco tiene JWT.
// No es una ruta pública — la protege `internalAuthMiddleware` con un secreto
// propio— pero sí tiene que quedar fuera del `authMiddleware` de abajo.
router.use('/internal', internalRoutes);
// Callback OAuth (el navegador volviendo de mercadopago.com) y webhook de pagos
// (lo llama Mercado Pago): ninguno de los dos trae JWT. El callback se protege
// con un `state` firmado y el webhook con la firma `x-signature` — ver
// `mercadopago.routes.ts`. El resto de la integración (conectar, catálogo de
// planes, pedir un link) sí requiere sesión y vive más abajo.
router.use('/mercadopago', mercadoPagoPublicRoutes);

// Protected routes - require authentication
router.use(authMiddleware);

// Admin routes (for managing gyms) - CRUD completo de gyms
router.use('/admin/gyms', requireAdmin, adminGymRoutes);

// Admin routes (for managing gym owner users) - CRUD completo de usuarios
router.use('/admin/users', requireAdmin, createAdminUserRoutes());

// Routes that need auth + tenant
router.use('/gyms', tenantMiddleware, gymRoutes);
router.use('/clients', tenantMiddleware, createClientRoutes());
router.use('/checkins', tenantMiddleware, createCheckInRoutes());
router.use('/invoices', tenantMiddleware, createInvoiceRoutes());
router.use('/ai-usage', tenantMiddleware, createAiUsageRoutes());
router.use('/routines', tenantMiddleware, routineRoutes);
// GET /onboarding/status: son datos del tenant (qué submissions llegaron y cuáles
// rebotaron, con DNI incluido), no información pública del webhook.
router.use('/onboarding', tenantMiddleware, onboardingStatusRoutes);
// El dashboard aplica tenantMiddleware por-ruta: /summary es cross-gym y no lleva.
router.use('/dashboard', createDashboardRouter());

// Búsqueda pública de entrenadores (requiere autenticación)
router.get('/entrenadores', authMiddleware, async (_req, res, next) => {
  try {
    const userRepo = new MongoUserRepository();
    const result = await userRepo.search({ role: 'entrenador', isActive: true }, 1, 50);
    res.json({ data: result.data, meta: { total: result.total } });
  } catch (err) {
    next(err);
  }
});

// Actualización del entrenador asociado al cliente
router.put('/users/:id/entrenador', authMiddleware, async (req, res, next) => {
  try {
    const userRepo = new MongoUserRepository();
    const useCase = new UpdateClienteEntrenadorUseCase(userRepo);
    const updated = await useCase.execute({
      userId: req.params.id,
      entrenadorId: req.body.entrenadorId ?? null,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
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
import { MongoUserRepository } from '../../../infrastructure/database/mongoose/repositories/MongoUserRepository';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { tenantMiddleware, getTenantId } from '../middlewares/tenantMiddleware';
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

// Registro público de entrenador independiente
router.post('/auth/register/entrenador', async (req, res, next) => {
  try {
    const userRepo = new MongoUserRepository();
    const gymRepo = new (require('../../../infrastructure/database/mongoose/repositories/MongoGymRepository').MongoGymRepository)();
    const createUserUseCase = new (require('../../../application/use-cases/user/CreateUserUseCase').CreateUserUseCase)(userRepo, gymRepo);
    const user = await createUserUseCase.execute({ ...req.body, role: 'entrenador' });
    res.status(201).json({ status: 'success', data: user });
  } catch (err) {
    next(err);
  }
});

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
router.get('/entrenadores', authMiddleware, async (req, res, next) => {
  try {
    const userRepo = new MongoUserRepository();
    const searchEntrenadoresUseCase = new (require('../../../application/use-cases/user/SearchEntrenadoresUseCase').SearchEntrenadoresUseCase)(userRepo);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await searchEntrenadoresUseCase.execute({ page, limit });
    const data = result.data.map((user: any) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      perfilPublico: user.perfilPublico,
      gymId: user.gymId,
    }));
    res.json({ status: 'success', data, meta: { total: result.total, page, limit } });
  } catch (err) {
    next(err);
  }
});

router.post('/services/:servicioId/payment-links', authMiddleware, tenantMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const gymId = getTenantId(req);
    const ServiceRepoClass = require('../../../infrastructure/database/mongoose/repositories/MongoServicePaymentRequestRepository').MongoServicePaymentRequestRepository;
    const serviceRepo = ServiceRepoClass ? new ServiceRepoClass() : null;
    // Placeholder: si no hay repositorio específico, usar el caso de uso con repositorio temporal
    const clientRepo = new (require('../../../infrastructure/database/mongoose/repositories/MongoClientRepository').MongoClientRepository)();
    const gymRepo = new (require('../../../infrastructure/database/mongoose/repositories/MongoGymRepository').MongoGymRepository)();
    const gymSecretsRepo = new (require('../../../infrastructure/database/mongoose/repositories/MongoGymSecretsRepository').MongoGymSecretsRepository)(new (require('../../../infrastructure/encryption/EncryptionService').EncryptionService)());
    const paymentFactory = new (require('../../../infrastructure/external/payments/MercadoPagoAdapterFactory').MercadoPagoAdapterFactory)();
    const whatsappFactory = new (require('../../../infrastructure/external/whatsapp/MetaCloudApiProviderFactory').MetaCloudApiProviderFactory)();
    const useCase = new (require('../../../application/use-cases/payments/CreateServicePaymentLinkUseCase').CreateServicePaymentLinkUseCase)(
      clientRepo, gymRepo, gymSecretsRepo, serviceRepo, paymentFactory, whatsappFactory
    );
    const result = await useCase.execute({
      servicioId: req.params.servicioId,
      gymId,
      clientId: req.body.clientId || req.user!.userId,
    });
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// Encuesta pendiente (antes de elegir entrenador)
router.patch('/survey/pending', authMiddleware, async (req: any, res, next) => {
  try {
    const PendingRepo = require('../../../infrastructure/database/mongoose/repositories/MongoPendingSurveyRepository').MongoPendingSurveyRepository;
    const repo = new PendingRepo();
    const result = await repo.createOrUpdate(req.user.userId, req.body);
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// Perfil del usuario autenticado
router.get('/users/me', authMiddleware, async (req: any, res, next) => {
  try {
    const userRepo = new MongoUserRepository();
    const getUserUseCase = new (require('../../../application/use-cases/user/GetUserUseCase').GetUserUseCase)(userRepo);
    const user = await getUserUseCase.execute({ userId: req.user.userId });
    res.json({ status: 'success', data: user });
  } catch (err) {
    next(err);
  }
});

router.put('/users/me/perfil', authMiddleware, async (req: any, res, next) => {
  try {
    const userRepo = new MongoUserRepository();
    const gymRepo = new (require('../../../infrastructure/database/mongoose/repositories/MongoGymRepository').MongoGymRepository)();
    const updateUserUseCase = new (require('../../../application/use-cases/user/UpdateUserUseCase').UpdateUserUseCase)(userRepo, gymRepo);
    const updated = await updateUserUseCase.execute({
      userId: req.user.userId,
      ...req.body,
    });
    res.json({ status: 'success', data: updated });
  } catch (err) {
    next(err);
  }
});

// Actualización del entrenador asociado al cliente
router.put('/users/:id/entrenador', authMiddleware, async (req, res, next) => {
  try {
    const userRepo = new MongoUserRepository();
    const clientRepo = new (require('../../../infrastructure/database/mongoose/repositories/MongoClientRepository').MongoClientRepository)();
    const gymRepo = new (require('../../../infrastructure/database/mongoose/repositories/MongoGymRepository').MongoGymRepository)();
    const useCase = new (require('../../../application/use-cases/user/SeleccionarEntrenadorUseCase').SeleccionarEntrenadorUseCase)(userRepo, clientRepo, gymRepo);
    const result = await useCase.execute({
      clienteUserId: req.params.id,
      entrenadorId: req.body.entrenadorId ?? null,
    });
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
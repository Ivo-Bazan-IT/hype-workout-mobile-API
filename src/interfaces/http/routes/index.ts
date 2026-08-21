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

export default router;
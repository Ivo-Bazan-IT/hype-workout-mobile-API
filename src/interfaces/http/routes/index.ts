import { Router } from 'express';
import { authRoutes } from './auth.routes';
import { gymRoutes, adminGymRoutes } from './gym.routes';
import { onboardingRoutes } from './onboarding.routes';
import { routineRoutes } from './routine.routes';
import { createClientRoutes } from './client.routes';
import { createInvoiceRoutes } from './invoice.routes';
import { createAiUsageRoutes } from './aiUsage.routes';
import { createDashboardRouter } from './dashboard.routes';
import { createAdminUserRoutes } from './user.routes';
import { authMiddleware } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { requireAdmin } from '../middlewares/roleMiddleware';

const router = Router();

// Public routes
router.use('/auth', authRoutes);
router.use('/onboarding', onboardingRoutes);

// Protected routes - require authentication
router.use(authMiddleware);

// Admin routes (for managing gyms) - CRUD completo de gyms
router.use('/admin/gyms', requireAdmin, adminGymRoutes);

// Admin routes (for managing gym owner users) - CRUD completo de usuarios
router.use('/admin/users', requireAdmin, createAdminUserRoutes());

// Routes that need auth + tenant
router.use('/gyms', tenantMiddleware, gymRoutes);
router.use('/clients', tenantMiddleware, createClientRoutes());
router.use('/invoices', tenantMiddleware, createInvoiceRoutes());
router.use('/ai-usage', tenantMiddleware, createAiUsageRoutes());
router.use('/routines', tenantMiddleware, routineRoutes);
// El dashboard aplica tenantMiddleware por-ruta: /summary es cross-gym y no lleva.
router.use('/dashboard', createDashboardRouter());

export default router;
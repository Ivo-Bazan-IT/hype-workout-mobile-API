import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { UserModel } from '../../src/infrastructure/database/mongoose/schemas/UserSchema';

/**
 * Test end-to-end del mantenimiento de dueños de gym por parte del super-admin.
 *
 * Ejercita la ruta HTTP real: authMiddleware + requireAdmin + validadores Zod +
 * casos de uso + Mongo en memoria. Los tests unitarios prueban la lógica con mocks;
 * esto prueba que el cableado completo responde como dice la documentación.
 *
 * Cuidado al extender: POST /api/auth/login tiene rate limit de 5 intentos por IP
 * cada 15 min, y el limitador se crea al importar el módulo de rutas, así que su
 * estado se comparte entre todos los tests de este archivo.
 */
describe('Mantenimiento de dueños de gym (e2e)', () => {
  let app: Application;

  const adminToken = jwt.sign(
    { userId: 'admin-1', email: 'super@admin.com', role: 'admin' },
    env.JWT_ACCESS_SECRET
  );

  const gymToken = jwt.sign(
    { userId: 'user-1', email: 'dueno@hype.com', role: 'gym', gymId: '66a00000000000000000a000' },
    env.JWT_ACCESS_SECRET
  );

  const nuevoGym = {
    name: 'Hype Workout',
    businessName: 'Hype SRL',
    cuit: '30712345678',
    contactEmail: 'info@hype.com',
    contactPhone: '5491122334455',
    adminEmail: 'dueno@hype.com',
    adminPassword: 'secret123',
    adminName: 'Dueño Original',
  };

  beforeAll(async () => {
    app = await createApp();
  });

  it('cubre el ciclo completo: crear, leer, actualizar, resetear clave y desactivar', async () => {
    // --- Alta del tenant (gym + su primer dueño) ---
    const gymRes = await request(app)
      .post('/api/admin/gyms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(nuevoGym)
      .expect(201);

    const gymId = gymRes.body.data.gym.id;
    expect(gymId).toBeTruthy();

    // --- CREATE: segundo dueño para el mismo gym ---
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'segundo@hype.com',
        password: 'otraClave123',
        name: 'Segundo Dueño',
        gymId,
      })
      .expect(201);

    const userId = createRes.body.data.id;
    expect(createRes.body.data.role).toBe('gym');
    expect(createRes.body.data.gymId).toBe(gymId);
    expect(createRes.body.data.isActive).toBe(true);
    // El hash de la contraseña nunca sale por HTTP
    expect(createRes.body.data.passwordHash).toBeUndefined();

    // --- READ (listado): los dos dueños del gym ---
    const listRes = await request(app)
      .get(`/api/admin/users?gymId=${gymId}&role=gym`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(listRes.body.data.total).toBe(2);
    expect(listRes.body.data.data.every((u: any) => u.passwordHash === undefined)).toBe(true);

    // --- READ (búsqueda por texto) ---
    const searchRes = await request(app)
      .get('/api/admin/users/search?q=segundo')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(searchRes.body.data.total).toBe(1);
    expect(searchRes.body.data.data[0].email).toBe('segundo@hype.com');

    // --- READ (individual) ---
    const getRes = await request(app)
      .get(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(getRes.body.data.name).toBe('Segundo Dueño');

    // --- UPDATE ---
    const updateRes = await request(app)
      .put(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nombre Corregido', email: 'corregido@hype.com' })
      .expect(200);

    expect(updateRes.body.data.name).toBe('Nombre Corregido');
    expect(updateRes.body.data.email).toBe('corregido@hype.com');

    // --- RESET DE CONTRASEÑA + login con la nueva (login #1) ---
    await request(app)
      .put(`/api/admin/users/${userId}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'claveNueva456' })
      .expect(200);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'corregido@hype.com', password: 'claveNueva456' })
      .expect(200);

    expect(loginRes.body.data.user.role).toBe('gym');
    expect(loginRes.body.data.accessToken).toBeTruthy();

    // --- DELETE (soft): deja de poder loguearse (login #2) ---
    await request(app)
      .delete(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'corregido@hype.com', password: 'claveNueva456' })
      .expect(401);

    // El usuario sigue existiendo, solo que inactivo (soft delete, no borrado)
    const afterDelete = await request(app)
      .get(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(afterDelete.body.data.isActive).toBe(false);

    // --- REACTIVAR ---
    const reactivated = await request(app)
      .put(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true })
      .expect(200);

    expect(reactivated.body.data.isActive).toBe(true);
  });

  it('rechaza a un usuario con rol gym (403)', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${gymToken}`)
      .expect(403);

    expect(res.body.message).toBe('Admin access required');
  });

  it('rechaza peticiones sin token (401)', async () => {
    await request(app).get('/api/admin/users').expect(401);
  });

  it('no permite desactivar a otro super-admin (403)', async () => {
    const otroAdmin = await UserModel.create({
      email: 'otro@admin.com',
      passwordHash: 'irrelevante',
      role: 'admin',
      name: 'Otro Admin',
      isActive: true,
    });

    const res = await request(app)
      .delete(`/api/admin/users/${otroAdmin._id.toString()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    expect(res.body.message).toBe('Only gym owner users can be managed from this endpoint');
  });

  it('valida el body al crear (400) y el gym inexistente (404)', async () => {
    await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'no-es-un-email', password: '123', name: '', gymId: '' })
      .expect(400);

    await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'valido@hype.com',
        password: 'claveValida123',
        name: 'Alguien',
        gymId: '66a00000000000000000a999',
      })
      .expect(404);
  });
});

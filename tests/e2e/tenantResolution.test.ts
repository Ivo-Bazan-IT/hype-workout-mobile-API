import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';

/**
 * Contrato de resolución de tenant, ahora centralizado en `tenantMiddleware`.
 *
 * Antes cada handler re-derivaba el gymId por su cuenta y las copias divergían:
 * el admin podía listar cualquier gym pero no escribir en ninguno, y las rutinas
 * consultaban con gymId `''`. Estos tests fijan la regla única para que no vuelva
 * a abrirse esa grieta.
 */
describe('Resolución de tenant (e2e)', () => {
  let app: Application;

  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();

  const gymToken = jwt.sign(
    { userId: 'user-1', email: 'dueno@hype.com', role: 'gym', gymId },
    env.JWT_ACCESS_SECRET
  );

  const adminToken = jwt.sign(
    { userId: 'admin-1', email: 'admin@hype.com', role: 'admin' },
    env.JWT_ACCESS_SECRET
  );

  const asGym = (req: request.Test) => req.set('Authorization', `Bearer ${gymToken}`);
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    app = await createApp();
  });

  describe('rol gym', () => {
    it('opera siempre sobre el gym de su token', async () => {
      await asGym(request(app).post('/api/clients'))
        .send({ nombre: 'Socio Propio', documento: '40111111' })
        .expect(201);

      const listado = await asGym(request(app).get('/api/clients')).expect(200);

      expect(listado.body.data.total).toBe(1);
      expect(listado.body.data.data[0].gymId).toBe(gymId);
    });

    it('no puede pisar su tenant con ?gymId= de otro gym', async () => {
      // Aunque mande el query param, el gymId del JWT manda: el cliente cae en SU gym.
      await asGym(request(app).post(`/api/clients?gymId=${otroGymId}`))
        .send({ nombre: 'Intento Cruzado', documento: '40222222' })
        .expect(201);

      const propio = await asGym(request(app).get('/api/clients')).expect(200);
      expect(propio.body.data.total).toBe(1);
      expect(propio.body.data.data[0].gymId).toBe(gymId);

      // Y el gym objetivo quedó vacío
      const ajeno = await asAdmin(
        request(app).get(`/api/clients?gymId=${otroGymId}`)
      ).expect(200);
      expect(ajeno.body.data.total).toBe(0);
    });
  });

  describe('rol admin', () => {
    it('rechaza con 400 explícito cuando no indica sobre qué gym opera', async () => {
      const res = await asAdmin(request(app).get('/api/clients')).expect(400);

      expect(res.body.message).toContain('gymId query parameter is required');
    });

    it('lee cualquier gym pasando ?gymId=', async () => {
      await asGym(request(app).post('/api/clients'))
        .send({ nombre: 'Socio Propio', documento: '40111111' })
        .expect(201);

      const res = await asAdmin(request(app).get(`/api/clients?gymId=${gymId}`)).expect(200);

      expect(res.body.data.total).toBe(1);
      expect(res.body.data.data[0].nombre).toBe('Socio Propio');
    });

    it('también ESCRIBE en el gym indicado (antes siempre daba 403)', async () => {
      await asAdmin(request(app).post(`/api/clients?gymId=${gymId}`))
        .send({ nombre: 'Alta Por Soporte', documento: '40333333' })
        .expect(201);

      // El cliente quedó en el gym del query param, visible para su dueño
      const res = await asGym(request(app).get('/api/clients')).expect(200);
      expect(res.body.data.data[0].nombre).toBe('Alta Por Soporte');
    });

    it('accede al dashboard del gym indicado', async () => {
      const res = await asAdmin(
        request(app).get(`/api/dashboard?gymId=${gymId}`)
      ).expect(200);

      expect(res.body.data).toHaveProperty('clientesActivos');
      expect(res.body.data).toHaveProperty('ingresos');
    });

    it('usa /dashboard/summary sin ?gymId= porque es cross-gym', async () => {
      await asAdmin(request(app).get('/api/dashboard/summary')).expect(200);
    });

    it('deja /dashboard/summary fuera del alcance del rol gym', async () => {
      await asGym(request(app).get('/api/dashboard/summary')).expect(403);
    });
  });

  describe('rutinas', () => {
    it('responde 404 para una rutina inexistente del gym indicado', async () => {
      // Antes el admin llegaba al repositorio con gymId '' y esto no era un 404.
      const routineId = new Types.ObjectId().toString();

      await asAdmin(
        request(app).get(`/api/routines/${routineId}?gymId=${gymId}`)
      ).expect(404);

      await asGym(request(app).get(`/api/routines/${routineId}`)).expect(404);
    });
  });
});

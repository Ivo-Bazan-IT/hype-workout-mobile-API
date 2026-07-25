import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { MongoAiUsageRepository } from '../../src/infrastructure/database/mongoose/repositories/MongoAiUsageRepository';

/**
 * Consumo de IA por gym: el dato que permite saber cuánto cuesta atender a cada
 * gimnasio. Hasta ahora el `usage` de los SDKs se descartaba.
 */
describe('Consumo de IA por gym (e2e)', () => {
  let app: Application;

  const repo = new MongoAiUsageRepository();

  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();
  const clientId = new Types.ObjectId().toString();

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

  const registrar = (overrides: Record<string, any> = {}) =>
    repo.create({
      gymId,
      clientId,
      routineId: new Types.ObjectId().toString(),
      provider: 'deepseek',
      model: 'deepseek-chat',
      tokensPrompt: 1000,
      tokensRespuesta: 2000,
      tokensTotal: 3000,
      costoEstimado: 0.01,
      ...overrides,
    });

  beforeAll(async () => {
    app = await createApp();
  });

  it('lista el consumo del gym rutina por rutina', async () => {
    await registrar();
    await registrar({ provider: 'openai', model: 'gpt-4o', tokensTotal: 500 });

    const res = await asGym(request(app).get('/api/ai-usage')).expect(200);

    expect(res.body.data.total).toBe(2);
    expect(res.body.data.data[0]).toHaveProperty('tokensTotal');
    expect(res.body.data.data[0]).toHaveProperty('costoEstimado');
    expect(res.body.data.data[0]).toHaveProperty('model');
  });

  it('no expone el consumo de otro gym', async () => {
    await registrar();
    await registrar({ gymId: otroGymId, tokensTotal: 999999 });

    const res = await asGym(request(app).get('/api/ai-usage')).expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.data[0].gymId).toBe(gymId);
  });

  it('filtra por proveedor', async () => {
    await registrar();
    await registrar({ provider: 'openai', model: 'gpt-4o' });

    const res = await asGym(request(app).get('/api/ai-usage?provider=openai')).expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.data[0].provider).toBe('openai');
  });

  it('rechaza un proveedor desconocido con 400', async () => {
    await asGym(request(app).get('/api/ai-usage?provider=gemini')).expect(400);
  });

  it('reporta el consumo agregado con desglose por modelo', async () => {
    await registrar({ tokensTotal: 3000, costoEstimado: 0.01 });
    await registrar({ tokensTotal: 1000, costoEstimado: 0.005 });
    await registrar({
      provider: 'openai',
      model: 'gpt-4o',
      tokensTotal: 2000,
      costoEstimado: 0.02,
    });

    const res = await asGym(request(app).get('/api/ai-usage/report')).expect(200);

    expect(res.body.data.rutinas).toBe(3);
    expect(res.body.data.tokensTotal).toBe(6000);
    expect(res.body.data.costoEstimado).toBe(0.035);
    expect(res.body.data.rutinasSinPrecio).toBe(0);
    expect(res.body.data.porModelo).toHaveLength(2);
    expect(res.body.data.porMes).toHaveLength(1);
  });

  it('avisa cuántas rutinas quedaron sin precio cargado', async () => {
    await registrar({ costoEstimado: 0.01 });
    await registrar({ model: 'modelo-sin-precio', costoEstimado: null });

    const res = await asGym(request(app).get('/api/ai-usage/report')).expect(200);

    // Sin este dato, un costo bajo sería indistinguible de "faltan precios"
    expect(res.body.data.rutinasSinPrecio).toBe(1);
    expect(res.body.data.costoEstimado).toBe(0.01);
  });

  it('rechaza un período invertido con 400', async () => {
    const res = await asGym(
      request(app).get('/api/ai-usage/report?desde=2026-06-01&hasta=2026-01-01')
    ).expect(400);

    expect(res.body.message).toContain('desde cannot be later than hasta');
  });

  it('deja al super-admin consultar el consumo de un gym con ?gymId=', async () => {
    await registrar();

    const res = await asAdmin(request(app).get(`/api/ai-usage?gymId=${gymId}`)).expect(200);
    expect(res.body.data.total).toBe(1);

    await asAdmin(request(app).get('/api/ai-usage')).expect(400);
  });

  it('exige autenticación', async () => {
    await request(app).get('/api/ai-usage').expect(401);
  });
});

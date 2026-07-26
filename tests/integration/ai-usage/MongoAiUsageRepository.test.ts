import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { MongoAiUsageRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoAiUsageRepository';

const repo = new MongoAiUsageRepository();

const gymId = new Types.ObjectId().toString();
const otroGymId = new Types.ObjectId().toString();
const clientId = new Types.ObjectId().toString();

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
    costoEstimado: 0.0025,
    fuenteCredencial: 'gym' as const,
    ...overrides,
  });

describe('MongoAiUsageRepository', () => {
  it('persiste un registro de consumo', async () => {
    const record = await registrar();

    expect(record.id).toBeDefined();
    expect(record.gymId).toBe(gymId);
    expect(record.tokensTotal).toBe(3000);
    expect(record.costoEstimado).toBe(0.0025);
  });

  it('conserva el costo null de un modelo sin precio', async () => {
    const record = await registrar({ model: 'modelo-raro', costoEstimado: null });

    expect(record.costoEstimado).toBeNull();

    const leido = await repo.search(gymId, { model: 'modelo-raro' });
    expect(leido.data[0].costoEstimado).toBeNull();
  });

  it('aísla por gym: no mezcla el consumo de otro tenant', async () => {
    await registrar();
    await registrar({ gymId: otroGymId, tokensTotal: 999999 });

    const result = await repo.search(gymId, {});

    expect(result.total).toBe(1);
    expect(result.data[0].tokensTotal).toBe(3000);
  });

  it('filtra por proveedor y modelo', async () => {
    await registrar();
    await registrar({ provider: 'openai', model: 'gpt-4o', tokensTotal: 500 });

    const porProveedor = await repo.search(gymId, { provider: 'openai' });
    expect(porProveedor.total).toBe(1);
    expect(porProveedor.data[0].tokensTotal).toBe(500);

    const porModelo = await repo.search(gymId, { model: 'deepseek-chat' });
    expect(porModelo.total).toBe(1);
  });

  it('agrega el consumo del período por mes y por modelo', async () => {
    await registrar({ tokensTotal: 3000, costoEstimado: 0.01 });
    await registrar({ tokensTotal: 1000, costoEstimado: 0.005 });
    await registrar({
      provider: 'openai',
      model: 'gpt-4o',
      tokensTotal: 2000,
      costoEstimado: 0.02,
    });

    const desde = new Date(Date.now() - 60_000);
    const hasta = new Date(Date.now() + 60_000);

    const report = await repo.getUsageByPeriod(gymId, desde, hasta);

    expect(report.rutinas).toBe(3);
    expect(report.tokensTotal).toBe(6000);
    expect(report.costoEstimado).toBe(0.035);
    expect(report.rutinasSinPrecio).toBe(0);

    // Desglose por modelo, ordenado por costo descendente
    expect(report.porModelo).toHaveLength(2);
    expect(report.porModelo[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      tokensTotal: 2000,
      costoEstimado: 0.02,
      rutinas: 1,
    });
    expect(report.porModelo[1]).toMatchObject({
      model: 'deepseek-chat',
      tokensTotal: 4000,
      rutinas: 2,
    });
  });

  it('cuenta las rutinas sin precio sin ensuciar el total de costo', async () => {
    await registrar({ tokensTotal: 1000, costoEstimado: 0.01 });
    await registrar({ model: 'modelo-raro', tokensTotal: 5000, costoEstimado: null });

    const report = await repo.getUsageByPeriod(
      gymId,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000)
    );

    // Los tokens sí se cuentan; el costo solo suma lo que tiene precio conocido
    expect(report.tokensTotal).toBe(6000);
    expect(report.costoEstimado).toBe(0.01);
    expect(report.rutinas).toBe(2);
    expect(report.rutinasSinPrecio).toBe(1);
  });

  it('el reporte no incluye consumo de otro gym', async () => {
    await registrar({ costoEstimado: 0.01 });
    await registrar({ gymId: otroGymId, costoEstimado: 99 });

    const report = await repo.getUsageByPeriod(
      gymId,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000)
    );

    expect(report.costoEstimado).toBe(0.01);
    expect(report.rutinas).toBe(1);
  });
});

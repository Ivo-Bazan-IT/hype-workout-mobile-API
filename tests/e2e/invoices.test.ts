import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { MongoInvoiceRepository } from '../../src/infrastructure/database/mongoose/repositories/MongoInvoiceRepository';

/**
 * Historial de facturación visible para el dueño del gym: el listado con filtros y
 * el reporte de ingresos. Hasta ahora las facturas se creaban al renovar un socio
 * pero no había ningún endpoint para consultarlas.
 */
describe('Facturación del gym (e2e)', () => {
  let app: Application;

  const repo = new MongoInvoiceRepository();

  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();
  const clientId = new Types.ObjectId().toString();
  const otroClientId = new Types.ObjectId().toString();

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

  const emitir = (overrides: Record<string, any> = {}) =>
    repo.create({
      gymId,
      clientId,
      tipoComprobante: 'Factura C',
      cae: '75123456789012',
      monto: 15000,
      estado: 'emitida',
      ...overrides,
    });

  beforeAll(async () => {
    app = await createApp();
  });

  it('lista el historial de facturación del gym', async () => {
    await emitir({ monto: 15000 });
    await emitir({ monto: 20000, clientId: otroClientId });

    const res = await asGym(request(app).get('/api/invoices')).expect(200);

    expect(res.body.data.total).toBe(2);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.data).toHaveLength(2);
    expect(res.body.data.data[0]).toHaveProperty('cae');
    expect(res.body.data.data[0]).toHaveProperty('monto');
  });

  it('no expone facturación de otro gym', async () => {
    await emitir();
    await repo.create({
      gymId: otroGymId,
      clientId: otroClientId,
      tipoComprobante: 'Factura B',
      cae: '99999999999999',
      monto: 500000,
      estado: 'emitida',
    });

    const res = await asGym(request(app).get('/api/invoices')).expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.data[0].gymId).toBe(gymId);
  });

  it('filtra por socio, estado y rango de fechas', async () => {
    await emitir({ clientId, monto: 15000, fechaEmision: new Date('2026-03-10') });
    await emitir({ clientId: otroClientId, monto: 20000, fechaEmision: new Date('2026-03-10') });
    await emitir({ estado: 'error', cae: '', monto: 7000, fechaEmision: new Date('2026-05-10') });

    const porSocio = await asGym(
      request(app).get(`/api/invoices?clientId=${otroClientId}`)
    ).expect(200);
    expect(porSocio.body.data.total).toBe(1);
    expect(porSocio.body.data.data[0].monto).toBe(20000);

    const porEstado = await asGym(request(app).get('/api/invoices?estado=error')).expect(200);
    expect(porEstado.body.data.total).toBe(1);

    const porFecha = await asGym(
      request(app).get('/api/invoices?emitidaDesde=2026-03-01&emitidaHasta=2026-03-31')
    ).expect(200);
    expect(porFecha.body.data.total).toBe(2);
  });

  it('rechaza un filtro de fecha inválido con 400', async () => {
    await asGym(request(app).get('/api/invoices?emitidaDesde=no-es-fecha')).expect(400);
  });

  it('devuelve el detalle de un comprobante y 404 si es de otro gym', async () => {
    const invoice = await emitir();

    const res = await asGym(request(app).get(`/api/invoices/${invoice.id}`)).expect(200);
    expect(res.body.data.cae).toBe('75123456789012');

    // El mismo comprobante, pedido por el dueño de otro gym, no existe
    const otroGymToken = jwt.sign(
      { userId: 'user-2', email: 'otro@gym.com', role: 'gym', gymId: otroGymId },
      env.JWT_ACCESS_SECRET
    );
    await request(app)
      .get(`/api/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${otroGymToken}`)
      .expect(404);
  });

  it('reporta ingresos por período con desglose mensual', async () => {
    await emitir({ monto: 1000, fechaEmision: new Date('2026-01-10') });
    await emitir({ monto: 500, fechaEmision: new Date('2026-01-20') });
    await emitir({ monto: 2000, fechaEmision: new Date('2026-02-10') });
    // Las fallidas no son plata cobrada
    await emitir({ monto: 9999, estado: 'error', cae: '', fechaEmision: new Date('2026-02-11') });

    const res = await asGym(
      request(app).get('/api/invoices/revenue?desde=2026-01-01&hasta=2026-02-28')
    ).expect(200);

    expect(res.body.data.total).toBe(3500);
    expect(res.body.data.cantidad).toBe(3);
    expect(res.body.data.porMes).toEqual([
      { year: 2026, month: 1, total: 1500, cantidad: 2 },
      { year: 2026, month: 2, total: 2000, cantidad: 1 },
    ]);
  });

  it('rechaza un período invertido con 400', async () => {
    const res = await asGym(
      request(app).get('/api/invoices/revenue?desde=2026-06-01&hasta=2026-01-01')
    ).expect(400);

    expect(res.body.message).toContain('desde cannot be later than hasta');
  });

  it('deja al super-admin consultar la facturación de un gym con ?gymId=', async () => {
    await emitir({ monto: 15000 });

    const res = await asAdmin(request(app).get(`/api/invoices?gymId=${gymId}`)).expect(200);
    expect(res.body.data.total).toBe(1);

    // Y sin indicar el gym, falla explícito en vez de mezclar tenants
    await asAdmin(request(app).get('/api/invoices')).expect(400);
  });

  it('exige autenticación', async () => {
    await request(app).get('/api/invoices').expect(401);
  });

  describe('POST /api/invoices/:id/retry', () => {
    const enError = (overrides: Record<string, any> = {}) =>
      emitir({ estado: 'error', cae: '', errorLog: 'CUIT inválido', intentos: 5, ...overrides });

    it('devuelve a la cola una factura que quedó en error', async () => {
      const invoice = await enError();

      const res = await asGym(request(app).post(`/api/invoices/${invoice.id}/retry`)).expect(200);

      expect(res.body.data.estado).toBe('pendiente');
      expect(res.body.data.intentos).toBe(0);

      // Y queda efectivamente tomable por el worker
      expect(await repo.claimPendiente(60_000)).not.toBeNull();
    });

    it('no reintenta una factura ya emitida', async () => {
      const invoice = await emitir({ estado: 'emitida' });

      const res = await asGym(request(app).post(`/api/invoices/${invoice.id}/retry`)).expect(400);

      expect(res.body.message).toContain('estado error');
    });

    it('no deja reintentar el comprobante de otro gym', async () => {
      const invoice = await enError();

      const otroGymToken = jwt.sign(
        { userId: 'user-2', email: 'otro@gym.com', role: 'gym', gymId: otroGymId },
        env.JWT_ACCESS_SECRET
      );
      await request(app)
        .post(`/api/invoices/${invoice.id}/retry`)
        .set('Authorization', `Bearer ${otroGymToken}`)
        .expect(404);

      // Y la factura sigue intacta, sin volver a la cola
      expect((await repo.findById(invoice.id, gymId))?.estado).toBe('error');
    });

    it('exige autenticación', async () => {
      const invoice = await enError();

      await request(app).post(`/api/invoices/${invoice.id}/retry`).expect(401);
    });
  });
});

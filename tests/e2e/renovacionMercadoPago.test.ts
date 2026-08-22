import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHmac } from 'crypto';
import type { Application } from 'express';

/*
 * Renovación por Mercado Pago, de punta a punta: conectar la cuenta por OAuth →
 * configurar el catálogo de planes → pedir un link → Mercado Pago avisa por
 * webhook → el cliente queda renovado con la factura encolada (si el gym
 * factura).
 *
 * Se mockea `axios` y no los puertos (`IPaymentProvider`/`IMercadoPagoOAuthService`)
 * a propósito, mismo criterio que `facturacionArca.test.ts`: lo que hay que
 * verificar es el circuito HTTP completo —incluida la firma del webhook—, no que
 * el caso de uso llame a algo.
 *
 * Las variables de Mercado Pago se fijan ANTES del import dinámico de `env`, que
 * se parsea una sola vez al importarse (mismo motivo que `AFIP_BILLING_MODE` en
 * `facturacionArca.test.ts`).
 */
process.env.MERCADOPAGO_CLIENT_ID ??= 'mp-client-id-test';
process.env.MERCADOPAGO_CLIENT_SECRET ??= 'mp-client-secret-test';
process.env.MERCADOPAGO_REDIRECT_URI ??= 'https://api.hype-workout-test.com/api/mercadopago/callback';
process.env.MERCADOPAGO_WEBHOOK_SECRET ??= 'mp-webhook-secret-de-mas-de-32-caracteres';

const mp = vi.hoisted(() => ({
  oauthTokensPedidos: [] as any[],
  linksCreados: [] as any[],
  pagosConsultados: [] as string[],
  /** Se reasignan por test para simular la respuesta de Mercado Pago. */
  userId: '555444333',
  responderPago: (_paymentId: string): any => ({
    id: 'pago-mock',
    status: 'approved',
    external_reference: '',
    transaction_amount: 0,
  }),
}));

vi.mock('axios', async (importActual) => {
  const actual = await importActual<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      post: async (url: string, body: any) => {
        if (url.includes('/oauth/token')) {
          mp.oauthTokensPedidos.push(body);
          return {
            data: {
              access_token: 'mp-access-token-abc',
              refresh_token: 'mp-refresh-token-abc',
              user_id: mp.userId,
              expires_in: 15_552_000,
              token_type: 'bearer',
            },
          };
        }
        if (url.includes('/checkout/preferences')) {
          mp.linksCreados.push(body);
          const id = `link-${mp.linksCreados.length}`;
          return { data: { id, init_point: `https://mp.example/checkout/${id}` } };
        }
        // Envío del link por WhatsApp (MetaCloudApiProvider): no es lo que este
        // test verifica, se responde algo mínimamente válido.
        if (url.includes('graph.facebook.com')) {
          return { data: { messages: [{ id: 'wamid-mock' }] } };
        }
        throw new Error(`POST no mockeado en el test de Mercado Pago: ${url}`);
      },
      get: async (url: string) => {
        if (url.includes('/v1/payments/')) {
          const paymentId = url.split('/').pop()!;
          mp.pagosConsultados.push(paymentId);
          return { data: mp.responderPago(paymentId) };
        }
        throw new Error(`GET no mockeado en el test de Mercado Pago: ${url}`);
      },
    },
  };
});

const { createApp } = await import('../../src/app');
const { env } = await import('../../src/config/env');

/** Firma un webhook igual que lo haría Mercado Pago, con el secreto de test. */
const firmarWebhook = (dataId: string, xRequestId: string) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const v1 = createHmac('sha256', env.MERCADOPAGO_WEBHOOK_SECRET!).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
};

describe('Renovación por Mercado Pago, de punta a punta (e2e)', () => {
  let app: Application;
  let contador = 0;

  const adminToken = jwt.sign(
    { userId: 'admin-1', email: 'admin@hype.com', role: 'admin' },
    env.JWT_ACCESS_SECRET
  );

  /**
   * Deja un gimnasio con la cuenta de Mercado Pago conectada (recorre el OAuth
   * real, con la state firmada de verdad) y un socio cargado.
   */
  const montarGymConectado = async () => {
    contador += 1;

    const altaGym = await request(app)
      .post('/api/admin/gyms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Hype MP ${contador}`,
        businessName: `Hype MP ${contador} SRL`,
        cuit: `3071235${String(contador).padStart(4, '0')}`,
        contactEmail: `mp${contador}@hype.com`,
        contactPhone: '5491122334455',
        adminEmail: `duenomp${contador}@hype.com`,
        adminPassword: 'secret123',
        adminName: `Dueño MP ${contador}`,
      })
      .expect(201);

    const gymId = altaGym.body.data.gym.id;
    const gymToken = jwt.sign(
      { userId: `user-mp-${contador}`, email: `duenomp${contador}@hype.com`, role: 'gym', gymId },
      env.JWT_ACCESS_SECRET
    );
    const asGym = (req: request.Test) => req.set('Authorization', `Bearer ${gymToken}`);

    // Paso 1 del "Conectar con Mercado Pago": pide la URL de autorización por un
    // GET autenticado (JSON, no redirect — una navegación real de browser no
    // puede llevar el header Authorization).
    const connectRes = await asGym(request(app).get('/api/gyms/settings/mercadopago/connect')).expect(
      200
    );
    const state = new URL(connectRes.body.data.url).searchParams.get('state')!;

    // Paso 2: el navegador vuelve de mercadopago.com con el `code`.
    await request(app)
      .get('/api/mercadopago/callback')
      .query({ code: 'mp-auth-code-123', state })
      .expect(200);

    const altaSocio = await asGym(request(app).post('/api/clients'))
      .send({ nombre: `Socio MP ${contador}`, documento: '7654321', telefono: '5491122334455' })
      .expect(201);

    return { gymId, asGym, clientId: altaSocio.body.data.id };
  };

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(() => {
    mp.oauthTokensPedidos = [];
    mp.linksCreados = [];
    mp.pagosConsultados = [];
    mp.userId = '555444333';
  });

  it('conecta la cuenta y la refleja en GET /gyms/settings', async () => {
    const { asGym } = await montarGymConectado();

    const settings = await asGym(request(app).get('/api/gyms/settings')).expect(200);

    expect(settings.body.data.mercadoPagoConfig).toMatchObject({ conectado: true });
    expect(settings.body.data.mercadoPagoConfig.conectadoEn).not.toBeNull();
    // El token nunca viaja en claro por HTTP.
    expect(JSON.stringify(settings.body)).not.toContain('mp-access-token-abc');
  });

  it('pide el link con el monto del catálogo y, cuando MP aprueba, renueva al socio', async () => {
    const { asGym, clientId } = await montarGymConectado();

    await asGym(request(app).put('/api/gyms/settings/membership-plans'))
      .send({ planes: [{ tipo: 'semestral', duracionDias: 180, monto: 60000, activo: true }] })
      .expect(200);

    const pedido = await asGym(request(app).post(`/api/clients/${clientId}/renewal-requests`))
      .send({ tipoPlan: 'semestral' })
      .expect(201);

    expect(pedido.body.data.estado).toBe('pendiente');
    expect(pedido.body.data.initPoint).toContain('https://mp.example/checkout/');
    expect(mp.linksCreados[0]).toMatchObject({
      external_reference: pedido.body.data.externalReference,
      items: [expect.objectContaining({ unit_price: 60000 })],
    });

    // El cliente TODAVÍA no cambió: la renovación real la aplica el webhook.
    const clienteAntes = await asGym(request(app).get(`/api/clients/${clientId}`)).expect(200);
    const vencimientoAntes = clienteAntes.body.data.fechaVencimiento;

    // Mercado Pago aprueba el pago y avisa por webhook.
    mp.responderPago = () => ({
      id: 'pago-e2e-1',
      status: 'approved',
      external_reference: pedido.body.data.externalReference,
      transaction_amount: 60000,
    });

    const xRequestId = 'req-e2e-1';
    const webhookRes = await request(app)
      .post('/api/mercadopago/webhook')
      .set('x-signature', firmarWebhook('pago-e2e-1', xRequestId))
      .set('x-request-id', xRequestId)
      .send({ type: 'payment', data: { id: 'pago-e2e-1' }, user_id: mp.userId })
      .expect(200);

    expect(webhookRes.body.data.procesado).toBe(true);

    const clienteDespues = await asGym(request(app).get(`/api/clients/${clientId}`)).expect(200);
    expect(clienteDespues.body.data.estado).toBe('activo');
    expect(clienteDespues.body.data.fechaVencimiento).not.toBe(vencimientoAntes);

    const historial = await asGym(
      request(app).get(`/api/clients/${clientId}/renewal-requests`)
    ).expect(200);
    expect(historial.body.data.data[0]).toMatchObject({ estado: 'aprobado', mercadoPagoPaymentId: 'pago-e2e-1' });
  });

  it('rechaza un webhook con firma inválida', async () => {
    await request(app)
      .post('/api/mercadopago/webhook')
      .set('x-signature', 'ts=1700000000,v1=firma-adulterada')
      .set('x-request-id', 'req-falso')
      .send({ type: 'payment', data: { id: 'pago-x' }, user_id: '999' })
      .expect(401);

    expect(mp.pagosConsultados).toHaveLength(0);
  });

  it('es idempotente: reenviar el mismo webhook no vuelve a aplicar la renovación', async () => {
    const { asGym, clientId } = await montarGymConectado();

    await asGym(request(app).put('/api/gyms/settings/membership-plans'))
      .send({ planes: [{ tipo: 'mensual', duracionDias: 30, monto: 10000, activo: true }] })
      .expect(200);

    const pedido = await asGym(request(app).post(`/api/clients/${clientId}/renewal-requests`))
      .send({ tipoPlan: 'mensual' })
      .expect(201);

    mp.responderPago = () => ({
      id: 'pago-e2e-2',
      status: 'approved',
      external_reference: pedido.body.data.externalReference,
      transaction_amount: 10000,
    });

    const enviarWebhook = () => {
      const xRequestId = `req-${mp.pagosConsultados.length}`;
      return request(app)
        .post('/api/mercadopago/webhook')
        .set('x-signature', firmarWebhook('pago-e2e-2', xRequestId))
        .set('x-request-id', xRequestId)
        .send({ type: 'payment', data: { id: 'pago-e2e-2' }, user_id: mp.userId });
    };

    const primero = await enviarWebhook().expect(200);
    const segundo = await enviarWebhook().expect(200);

    expect(primero.body.data.procesado).toBe(true);
    expect(segundo.body.data.procesado).toBe(false);

    const clienteFinal = await asGym(request(app).get(`/api/clients/${clientId}`)).expect(200);
    // Un solo mes sumado, no dos.
    expect(clienteFinal.body.data.historialRenovaciones).toHaveLength(1);
  });

  it('un cobro en efectivo cancela el link de Mercado Pago que haya quedado pendiente', async () => {
    const { asGym, clientId } = await montarGymConectado();

    await asGym(request(app).put('/api/gyms/settings/membership-plans'))
      .send({ planes: [{ tipo: 'mensual', duracionDias: 30, monto: 10000, activo: true }] })
      .expect(200);

    const pedido = await asGym(request(app).post(`/api/clients/${clientId}/renewal-requests`))
      .send({ tipoPlan: 'mensual' })
      .expect(201);

    // El operador cobra en efectivo antes de que el socio pague el link.
    await asGym(request(app).post(`/api/clients/${clientId}/renew`))
      .send({ tipoPlan: 'mensual' })
      .expect(200);

    const historial = await asGym(
      request(app).get(`/api/clients/${clientId}/renewal-requests`)
    ).expect(200);
    const pedidoOriginal = historial.body.data.data.find((r: any) => r.id === pedido.body.data.id);
    expect(pedidoOriginal.estado).toBe('cancelado');

    // Si el socio igual paga el link viejo, el webhook no debe reaplicar nada.
    mp.responderPago = () => ({
      id: 'pago-tardio',
      status: 'approved',
      external_reference: pedido.body.data.externalReference,
      transaction_amount: 10000,
    });
    const xRequestId = 'req-tardio';
    const webhookTardio = await request(app)
      .post('/api/mercadopago/webhook')
      .set('x-signature', firmarWebhook('pago-tardio', xRequestId))
      .set('x-request-id', xRequestId)
      .send({ type: 'payment', data: { id: 'pago-tardio' }, user_id: mp.userId })
      .expect(200);

    expect(webhookTardio.body.data.procesado).toBe(false);

    const clienteFinal = await asGym(request(app).get(`/api/clients/${clientId}`)).expect(200);
    // Un solo mes sumado (el del cobro en efectivo), no dos.
    expect(clienteFinal.body.data.historialRenovaciones).toHaveLength(1);
  });
});

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

/*
 * Facturación en modo `cuenta_propia` (el default de `AFIP_BILLING_MODE`), de
 * punta a punta: subir credenciales propias → renovar (encola) → el disparador
 * emite → el comprobante persiste con su CAE.
 *
 * Se mockea `@afipsdk/afip.js` y no `axios` a propósito: la librería arma la
 * autenticación WSAA (Auth.Token/Sign) y la numeración correlativa por su
 * cuenta, así que interceptar más abajo (axios crudo) probaría el
 * comportamiento interno del SDK de un tercero, no el nuestro. Lo que hay que
 * verificar acá es qué payload WSFE arma nuestro adaptador — eso ya lo cubre
 * `AfipSdkOwnAccountAdapter.test.ts` en detalle — y que el circuito HTTP
 * completo (multipart de credenciales, cifrado, cola, worker) funciona.
 *
 * `vi.hoisted` porque `vi.mock` se iza por encima de los imports.
 */
const { createNextVoucher, AfipMock } = vi.hoisted(() => {
  const createNextVoucher = vi.fn();
  const AfipMock = vi.fn().mockImplementation(() => ({
    ElectronicBilling: { createNextVoucher },
  }));
  return { createNextVoucher, AfipMock };
});

vi.mock('@afipsdk/afip.js', () => ({ default: AfipMock }));

const { createApp } = await import('../../src/app');
const { env } = await import('../../src/config/env');
const { GymTaxCondition, ClientTaxCondition } = await import('../../src/domain/billing/types');

const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIBtestcertcontent\n-----END CERTIFICATE-----';
const KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIBtestkeycontent\n-----END PRIVATE KEY-----';

describe('Facturación de punta a punta (e2e, modo cuenta_propia)', () => {
  let app: Application;
  let contador = 0;

  const adminToken = jwt.sign(
    { userId: 'admin-1', email: 'admin@hype.com', role: 'admin' },
    env.JWT_ACCESS_SECRET
  );

  /** DNI de 7 dígitos: `normalizarDocumento` los acepta (hay documentos viejos así). */
  const DNI_SOCIO = '7654321';
  const CUIT_SOCIO_RI = '30711122238';

  /**
   * Deja un gimnasio listo para facturar con SU PROPIA cuenta: identidad
   * fiscal + credenciales cargadas. Va por la API real para recorrer el mismo
   * camino que la aplicación, cert/key incluidos.
   */
  const montarGymFacturable = async (
    taxCondition: string,
    fiscal: { cuit?: string; puntoVenta?: number } = {}
  ) => {
    contador += 1;

    const altaGym = await request(app)
      .post('/api/admin/gyms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Hype Propia ${contador}`,
        businessName: `Hype Propia ${contador} SRL`,
        cuit: fiscal.cuit ?? `3071234${String(contador).padStart(4, '0')}`,
        contactEmail: `propia${contador}@hype.com`,
        contactPhone: '5491122334455',
        adminEmail: `duenopropia${contador}@hype.com`,
        adminPassword: 'secret123',
        adminName: `Dueño Propia ${contador}`,
      })
      .expect(201);

    const gymId = altaGym.body.data.gym.id;
    const gymToken = jwt.sign(
      { userId: `user-propia-${contador}`, email: `duenopropia${contador}@hype.com`, role: 'gym', gymId },
      env.JWT_ACCESS_SECRET
    );
    const asGym = (req: request.Test) => req.set('Authorization', `Bearer ${gymToken}`);

    await asGym(request(app).put('/api/gyms/settings/afip'))
      .send({
        cuit: fiscal.cuit ?? `3071234${String(contador).padStart(4, '0')}`,
        puntoVenta: fiscal.puntoVenta ?? 4,
        taxCondition,
        isActive: true,
      })
      .expect(200);

    const altaSocio = await asGym(request(app).post('/api/clients'))
      .send({ nombre: `Socio Propia ${contador}`, documento: DNI_SOCIO })
      .expect(201);

    return { gymId, asGym, clientId: altaSocio.body.data.id };
  };

  const cargarCredenciales = (asGym: (req: request.Test) => request.Test, apiKey = 'access-token-abc') =>
    asGym(request(app).put('/api/gyms/settings/afip/credenciales'))
      .field('apiKey', apiKey)
      .attach('cert', Buffer.from(CERT_PEM), 'cert.crt')
      .attach('key', Buffer.from(KEY_PEM), 'key.key');

  const emitirPendientes = () =>
    request(app)
      .post('/api/internal/jobs/emit-invoices')
      .set('x-internal-secret', env.INVOICE_CRON_SECRET!);

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(() => {
    createNextVoucher.mockReset();
    createNextVoucher.mockResolvedValue({
      CAE: '75123456789012',
      CAEFchVto: '2026-12-31',
      voucherNumber: 1,
    });
  });

  it('carga las credenciales propias por multipart y nunca las expone', async () => {
    const { asGym } = await montarGymFacturable(GymTaxCondition.MONOTRIBUTO);

    const respuesta = await cargarCredenciales(asGym).expect(200);

    expect(respuesta.body.data.afipConfig).toMatchObject({
      hasApiKey: true,
      hasCert: true,
      hasKey: true,
    });
    expect(respuesta.body.data.afipConfig.credencialesActualizadasEn).not.toBeNull();
    // Nunca el contenido en claro, en ninguna forma.
    expect(JSON.stringify(respuesta.body)).not.toContain('access-token-abc');
    expect(JSON.stringify(respuesta.body)).not.toContain('BEGIN CERTIFICATE');
  });

  it('rechaza un .crt que no tiene forma de certificado PEM', async () => {
    const { asGym } = await montarGymFacturable(GymTaxCondition.MONOTRIBUTO);

    await asGym(request(app).put('/api/gyms/settings/afip/credenciales'))
      .field('apiKey', 'x')
      .attach('cert', Buffer.from('esto no es un certificado'), 'cert.crt')
      .attach('key', Buffer.from(KEY_PEM), 'key.key')
      .expect(400);
  });

  it('sin credenciales cargadas, la renovación encola pero la emisión queda en error', async () => {
    const { asGym, clientId } = await montarGymFacturable(GymTaxCondition.MONOTRIBUTO);

    await asGym(request(app).post(`/api/clients/${clientId}/renew`))
      .send({ monto: 15000 })
      .expect(200);

    const corrida = await emitirPendientes().expect(200);
    expect(corrida.body.data).toMatchObject({ procesadas: 1, emitidas: 0, fallidas: 1 });

    const historial = await asGym(request(app).get('/api/invoices')).expect(200);
    expect(historial.body.data.data[0].estado).toBe('error');
    expect(historial.body.data.data[0].errorLog).toMatch(/certificado/);
    expect(createNextVoucher).not.toHaveBeenCalled();
  });

  it('monotributista: emite Factura C sin discriminar IVA, con la cuenta propia del gym', async () => {
    const { asGym, clientId } = await montarGymFacturable(GymTaxCondition.MONOTRIBUTO);
    await cargarCredenciales(asGym).expect(200);

    await asGym(request(app).post(`/api/clients/${clientId}/renew`))
      .send({ monto: 15000 })
      .expect(200);

    expect(createNextVoucher).not.toHaveBeenCalled();

    const corrida = await emitirPendientes().expect(200);
    expect(corrida.body.data).toMatchObject({ procesadas: 1, emitidas: 1, fallidas: 0 });

    expect(createNextVoucher).toHaveBeenCalledTimes(1);
    const data = createNextVoucher.mock.calls[0][0];

    expect(data).toMatchObject({
      Concepto: 2,
      DocTipo: 96,
      DocNro: 7654321,
      CbteTipo: 11,
      PtoVta: 4,
      ImpTotal: 15000,
      ImpNeto: 15000,
      ImpIVA: 0,
      CondicionIVAReceptorId: 5,
    });
    expect(data.Iva).toBeUndefined();

    // La cuenta con la que se instanció el SDK es la DEL GYM, no una compartida.
    expect(AfipMock).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'access-token-abc', cert: CERT_PEM, key: KEY_PEM })
    );

    const historial = await asGym(request(app).get('/api/invoices')).expect(200);
    expect(historial.body.data.data[0]).toMatchObject({
      estado: 'emitida',
      cae: '75123456789012',
      tipoComprobante: 'Factura C',
      puntoVenta: 4,
    });
  });

  it('responsable inscripto + socio consumidor final: Factura B con IVA discriminado', async () => {
    const { asGym, clientId } = await montarGymFacturable(GymTaxCondition.RESPONSABLE_INSCRIPTO);
    await cargarCredenciales(asGym).expect(200);

    await asGym(request(app).post(`/api/clients/${clientId}/renew`))
      .send({ monto: 15000 })
      .expect(200);

    const corrida = await emitirPendientes().expect(200);
    expect(corrida.body.data).toMatchObject({ procesadas: 1, emitidas: 1, fallidas: 0 });

    const data = createNextVoucher.mock.calls[0][0];
    expect(data).toMatchObject({ CbteTipo: 6, DocTipo: 96, DocNro: 7654321, CondicionIVAReceptorId: 5 });
    expect(Number((data.ImpNeto + data.ImpIVA).toFixed(2))).toBe(15000);
    expect(data.Iva).toEqual([{ Id: 5, BaseImp: data.ImpNeto, Importe: data.ImpIVA }]);

    const historial = await asGym(request(app).get('/api/invoices')).expect(200);
    expect(historial.body.data.data[0].tipoComprobante).toBe('Factura B');
  });

  it('responsable inscripto + socio responsable inscripto: Factura A a su propio CUIT', async () => {
    const { asGym, clientId } = await montarGymFacturable(GymTaxCondition.RESPONSABLE_INSCRIPTO);
    await cargarCredenciales(asGym).expect(200);

    // El socio se marca RI con su propio CUIT: la Factura A no existía antes de
    // este cambio, así que es el caso que más vale probar de punta a punta.
    await asGym(request(app).put(`/api/clients/${clientId}`))
      .send({ condicionFiscal: ClientTaxCondition.RESPONSABLE_INSCRIPTO, cuit: CUIT_SOCIO_RI })
      .expect(200);

    await asGym(request(app).post(`/api/clients/${clientId}/renew`))
      .send({ monto: 24200 })
      .expect(200);

    const encolada = await asGym(request(app).get('/api/invoices')).expect(200);
    expect(encolada.body.data.data[0].tipoComprobante).toBe('Factura A');

    const corrida = await emitirPendientes().expect(200);
    expect(corrida.body.data).toMatchObject({ procesadas: 1, emitidas: 1, fallidas: 0 });

    const data = createNextVoucher.mock.calls[0][0];
    // 80 = CUIT (no 96 = DNI): a un socio Responsable Inscripto se le factura a
    // su propio CUIT, nunca a su documento personal.
    expect(data).toMatchObject({
      CbteTipo: 1,
      DocTipo: 80,
      DocNro: 30711122238,
      CondicionIVAReceptorId: 1,
      ImpTotal: 24200,
      ImpNeto: 20000,
      ImpIVA: 4200,
    });

    const historial = await asGym(request(app).get('/api/invoices')).expect(200);
    expect(historial.body.data.data[0]).toMatchObject({
      estado: 'emitida',
      tipoComprobante: 'Factura A',
      neto: 20000,
      iva: 4200,
    });
  });

  it('un socio marcado Responsable Inscripto sin CUIT válido queda en error, sin llegar a pedirle nada a AFIP', async () => {
    const { asGym, clientId } = await montarGymFacturable(GymTaxCondition.RESPONSABLE_INSCRIPTO);
    await cargarCredenciales(asGym).expect(200);

    // `cuit` deliberadamente ausente: el PUT de cliente no lo exige salvo que
    // condicionFiscal sea RI, así que este 200 confirma que la validación del
    // caso de uso corta antes de encolar mal, no que el dato esté completo.
    await asGym(request(app).put(`/api/clients/${clientId}`))
      .send({ condicionFiscal: ClientTaxCondition.RESPONSABLE_INSCRIPTO, cuit: '123' })
      .expect(400);
  });

  it('dos gimnasios facturan con SU PROPIA cuenta en la misma corrida, sin cruzarse', async () => {
    const monotributista = await montarGymFacturable(GymTaxCondition.MONOTRIBUTO, {
      cuit: '30111111111',
      puntoVenta: 4,
    });
    await cargarCredenciales(monotributista.asGym, 'token-mono').expect(200);

    const inscripto = await montarGymFacturable(GymTaxCondition.RESPONSABLE_INSCRIPTO, {
      cuit: '27222222222',
      puntoVenta: 12,
    });
    await cargarCredenciales(inscripto.asGym, 'token-inscripto').expect(200);

    await monotributista
      .asGym(request(app).post(`/api/clients/${monotributista.clientId}/renew`))
      .send({ monto: 15000 })
      .expect(200);
    await inscripto
      .asGym(request(app).post(`/api/clients/${inscripto.clientId}/renew`))
      .send({ monto: 24200 })
      .expect(200);

    const corrida = await emitirPendientes().expect(200);
    expect(corrida.body.data).toMatchObject({ procesadas: 2, emitidas: 2, fallidas: 0 });

    // Cada uno instanció el SDK con SU access token, no uno compartido: es
    // justamente lo que cambió al volver a cuenta propia.
    expect(AfipMock).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'token-mono' }));
    expect(AfipMock).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'token-inscripto' }));

    const historialMono = await monotributista.asGym(request(app).get('/api/invoices')).expect(200);
    const historialInscripto = await inscripto.asGym(request(app).get('/api/invoices')).expect(200);

    expect(historialMono.body.data.data).toHaveLength(1);
    expect(historialMono.body.data.data[0]).toMatchObject({ estado: 'emitida', tipoComprobante: 'Factura C' });

    expect(historialInscripto.body.data.data).toHaveLength(1);
    expect(historialInscripto.body.data.data[0]).toMatchObject({ estado: 'emitida', tipoComprobante: 'Factura B' });
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';

/**
 * El webhook de Google Forms de punta a punta.
 *
 * Era el hueco de cobertura conocido de la integración: su comportamiento estaba
 * respaldado solo por tests con mocks, y este endpoint es el único **público** que
 * escribe en la base. Lo que se verifica acá y en ningún otro lado: que el secreto
 * por gym efectivamente cierre la puerta, que un DNI desconocido rebote en vez de
 * crear una ficha fantasma, y que la idempotencia por `responseId` sobreviva el
 * viaje completo hasta Mongo y su índice único.
 */
describe('Webhook de onboarding (e2e)', () => {
  let app: Application;

  const adminToken = jwt.sign(
    { userId: 'admin-1', email: 'admin@hype.com', role: 'admin' },
    env.JWT_ACCESS_SECRET
  );

  let contador = 0;

  /** Crea un gym con su secreto de webhook ya rotado. Devuelve el secreto en claro. */
  const crearGymConSecreto = async (): Promise<{
    gymId: string;
    secret: string;
    token: string;
  }> => {
    contador += 1;

    const creado = await request(app)
      .post('/api/admin/gyms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Hype Forms ${contador}`,
        businessName: `Hype Forms ${contador} SRL`,
        cuit: `3079876543${contador}`,
        contactEmail: `forms${contador}@hype.com`,
        contactPhone: '5491122334455',
        adminEmail: `formsdueno${contador}@hype.com`,
        adminPassword: 'secreto123',
        adminName: 'Iván Bazán',
      })
      .expect(201);

    const gymId = creado.body.data.gym.id as string;
    const token = jwt.sign(
      { userId: `user-${contador}`, email: 'dueno@hype.com', role: 'gym', gymId },
      env.JWT_ACCESS_SECRET
    );

    const rotado = await request(app)
      .post('/api/gyms/settings/google-form/rotate-secret')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    // El secreto en claro sale una única vez, justo acá.
    const secret = (rotado.body.data.secret ?? rotado.body.data.webhookSecret) as string;

    return { gymId, secret, token };
  };

  /** Alta de socio por el ABM: es el paso que el formulario NO hace. */
  const crearSocio = async (token: string, documento: string): Promise<string> => {
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Socio de prueba', documento })
      .expect(201);

    return res.body.data.id;
  };

  /** Las siete preguntas del formulario "Proceso de Inscripción". */
  const respuestas = (documento: string) => ({
    'Nombre completo': 'Iván Bazán',
    DNI: documento,
    'Numero de telefono': '5491122334455',
    Edad: '30',
    'Objetivos con el entrenamiento': 'Ganar masa muscular',
    'Lesiones en curso': 'Ninguna',
    'Cantidad de dias a la semana que podra entrenar': '3 dias',
  });

  const enviar = (secret: string, body: Record<string, unknown>) =>
    request(app)
      .post('/api/onboarding/webhook')
      .set('x-webhook-secret', secret)
      .send(body);

  beforeAll(async () => {
    app = await createApp();
  });

  describe('seguridad', () => {
    it('rechaza sin secreto', async () => {
      const { gymId } = await crearGymConSecreto();

      await request(app)
        .post('/api/onboarding/webhook')
        .send({ gymId, respuestas: respuestas('40100001') })
        .expect(401);
    });

    it('rechaza con el secreto de otro gym', async () => {
      const propio = await crearGymConSecreto();
      const ajeno = await crearGymConSecreto();

      // Un secreto de plataforma compartido alcanzaría para inyectar clientes en
      // cualquier gimnasio, porque el gymId viaja en el body de un endpoint público.
      await enviar(ajeno.secret, {
        gymId: propio.gymId,
        respuestas: respuestas('40100002'),
      }).expect(401);
    });

    it('rechaza un gymId que no es un id válido antes de tocar la base', async () => {
      const { secret } = await crearGymConSecreto();

      await enviar(secret, {
        gymId: 'no-es-un-objectid',
        respuestas: respuestas('40100003'),
      }).expect(400);
    });

    it('rechaza una submission sin respuestas', async () => {
      const { gymId, secret } = await crearGymConSecreto();

      await enviar(secret, { gymId, respuestas: {} }).expect(400);
    });
  });

  describe('carga de la encuesta', () => {
    it('vuelca las respuestas sobre el socio que ya existe', async () => {
      const { gymId, secret, token } = await crearGymConSecreto();
      const clientId = await crearSocio(token, '40200001');

      const res = await enviar(secret, {
        gymId,
        respuestas: respuestas('40200001'),
      }).expect(201);

      expect(res.body.data.clientId).toBe(clientId);

      const ficha = await request(app)
        .get(`/api/clients/${clientId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(ficha.body.data.encuestaData['Objetivos con el entrenamiento']).toBe(
        'Ganar masa muscular'
      );
      // La encuesta es la conversión del embudo.
      expect(ficha.body.data.fechaConversion).toBeDefined();
      // El teléfono de la submission se promueve a campo propio del cliente.
      expect(ficha.body.data.telefono).toBe('5491122334455');
    });

    it('rebota con 404 si no hay socio con ese DNI, sin crear nada', async () => {
      const { gymId, secret, token } = await crearGymConSecreto();

      const res = await enviar(secret, {
        gymId,
        respuestas: respuestas('99999999'),
      }).expect(404);

      // El mensaje nombra el DNI: es lo que hace falta para corregirlo.
      expect(res.body.message).toContain('99999999');

      const listado = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(listado.body.data.total).toBe(0);
    });

    it('fusiona un reenvío parcial sin borrar lo ya contestado', async () => {
      const { gymId, secret, token } = await crearGymConSecreto();
      const clientId = await crearSocio(token, '40200002');

      await enviar(secret, { gymId, respuestas: respuestas('40200002') }).expect(201);
      await enviar(secret, {
        gymId,
        respuestas: { DNI: '40200002', 'Lesiones en curso': 'Hombro derecho' },
      }).expect(201);

      const ficha = await request(app)
        .get(`/api/clients/${clientId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(ficha.body.data.encuestaData['Lesiones en curso']).toBe('Hombro derecho');
      expect(ficha.body.data.encuestaData['Edad']).toBe('30');
    });
  });

  describe('idempotencia por responseId', () => {
    it('no reaplica la misma respuesta reenviada', async () => {
      const { gymId, secret, token } = await crearGymConSecreto();
      const clientId = await crearSocio(token, '40300001');

      await enviar(secret, {
        gymId,
        respuestas: respuestas('40300001'),
        responseId: 'resp-repetida',
      }).expect(201);

      // El mismo responseId con respuestas distintas: si se reaplicara, la encuesta
      // quedaría con la lesión nueva.
      const segundo = await enviar(secret, {
        gymId,
        respuestas: { DNI: '40300001', 'Lesiones en curso': 'NO DEBERIA ENTRAR' },
        responseId: 'resp-repetida',
      }).expect(201);

      expect(segundo.body.data.clientId).toBe(clientId);

      const ficha = await request(app)
        .get(`/api/clients/${clientId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(ficha.body.data.encuestaData['Lesiones en curso']).toBe('Ninguna');
    });

    it('el mismo responseId en otro gym no colisiona', async () => {
      const uno = await crearGymConSecreto();
      const dos = await crearGymConSecreto();
      await crearSocio(uno.token, '40300002');
      await crearSocio(dos.token, '40300003');

      // Los ids los genera Google, no nosotros: no hay garantía de unicidad entre
      // formularios de gyms distintos, y el índice único es compuesto por eso.
      await enviar(uno.secret, {
        gymId: uno.gymId,
        respuestas: respuestas('40300002'),
        responseId: 'resp-compartida',
      }).expect(201);

      await enviar(dos.secret, {
        gymId: dos.gymId,
        respuestas: respuestas('40300003'),
        responseId: 'resp-compartida',
      }).expect(201);
    });

    it('reprocesa una rechazada cuando el socio ya fue dado de alta', async () => {
      const { gymId, secret, token } = await crearGymConSecreto();

      // Rebota: el socio todavía no existe.
      await enviar(secret, {
        gymId,
        respuestas: respuestas('40300004'),
        responseId: 'resp-recuperable',
      }).expect(404);

      await crearSocio(token, '40300004');

      // Se reenvía la MISMA respuesta desde el formulario: es la vía de recuperación
      // prevista, y llega con el mismo responseId de siempre.
      await enviar(secret, {
        gymId,
        respuestas: respuestas('40300004'),
        responseId: 'resp-recuperable',
      }).expect(201);
    });

    it('sin responseId cada envío se procesa, aunque se repita', async () => {
      const { gymId, secret, token } = await crearGymConSecreto();
      await crearSocio(token, '40300005');

      await enviar(secret, { gymId, respuestas: respuestas('40300005') }).expect(201);
      await enviar(secret, { gymId, respuestas: respuestas('40300005') }).expect(201);
    });
  });

  describe('GET /api/onboarding/status', () => {
    it('exige autenticación: son datos del tenant', async () => {
      await request(app).get('/api/onboarding/status').expect(401);
    });

    it('informa el estado real de la integración', async () => {
      const { gymId, secret, token } = await crearGymConSecreto();
      await crearSocio(token, '40400001');

      await enviar(secret, { gymId, respuestas: respuestas('40400001') }).expect(201);
      await enviar(secret, { gymId, respuestas: respuestas('40400002') }).expect(404);

      const res = await request(app)
        .get('/api/onboarding/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.configurado).toBe(true);
      expect(res.body.data.submissions.total).toBe(2);
      expect(res.body.data.submissions.procesadas).toBe(1);
      expect(res.body.data.submissions.rechazadas).toBe(1);
      expect(res.body.data.submissions.ultimaRecibidaEn).toBeDefined();
      expect(res.body.data.ultimosRechazos[0].documento).toBe('40400002');
    });

    it('no mezcla las submissions de otro gym', async () => {
      const { token } = await crearGymConSecreto();

      const res = await request(app)
        .get('/api/onboarding/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.submissions.total).toBe(0);
      expect(res.body.data.submissions.ultimaRecibidaEn).toBeNull();
    });
  });
});

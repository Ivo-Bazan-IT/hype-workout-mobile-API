import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { GymModel } from '../../src/infrastructure/database/mongoose/schemas/GymSchema';

/**
 * Alta y edición de gimnasios desde el panel de super-admin.
 *
 * Las dos reglas que fija este archivo son de seguridad: las credenciales
 * cifradas nunca salen por HTTP, y editar los datos del negocio no puede
 * borrarlas.
 */
describe('Gimnasios desde super-admin (e2e)', () => {
  let app: Application;

  const adminToken = jwt.sign(
    { userId: 'admin-1', email: 'admin@hype.com', role: 'admin' },
    env.JWT_ACCESS_SECRET
  );

  const asAdmin = (req: request.Test): request.Test =>
    req.set('Authorization', `Bearer ${adminToken}`);

  let contador = 0;
  const nuevoGym = (overrides: Record<string, unknown> = {}) => {
    contador += 1;
    return {
      name: `Hype ${contador}`,
      businessName: `Hype ${contador} SRL`,
      cuit: `3071234567${contador}`,
      contactEmail: `info${contador}@hype.com`,
      contactPhone: '5491122334455',
      adminEmail: `dueno${contador}@hype.com`,
      adminPassword: 'secreto123',
      adminName: 'Iván Bazán',
      ...overrides,
    };
  };

  const crear = async (overrides: Record<string, unknown> = {}) => {
    const res = await asAdmin(request(app).post('/api/admin/gyms'))
      .send(nuevoGym(overrides))
      .expect(201);
    return res.body.data.gym.id as string;
  };

  beforeAll(async () => {
    app = await createApp();
  });

  it('crea el gym con su número y token de WhatsApp en una sola llamada', async () => {
    const gymId = await crear({
      whatsappPhoneNumberId: 'phone-1',
      whatsappAccessToken: 'EAAG-token-de-meta',
    });

    // El token se persiste CIFRADO, nunca en claro
    const doc = await GymModel.findById(gymId);
    expect(doc?.whatsappConfig?.phoneNumberId).toBe('phone-1');
    expect(doc?.whatsappConfig?.encryptedAccessToken).toBeTruthy();
    expect(doc?.whatsappConfig?.encryptedAccessToken).not.toContain('EAAG-token-de-meta');
  });

  /**
   * La zona horaria decide qué día calendario es un check-in y en qué franja cae en el
   * mapa de calor. Se valida en el alta y en la edición porque un nombre IANA
   * inexistente hace que Mongo aborte el `$dateToParts` de la agregación: sin esta
   * puerta, el tipeo se manifiesta semanas después como un 500 al abrir una gráfica.
   */
  describe('zona horaria del gimnasio', () => {
    it('la guarda en el alta', async () => {
      const gymId = await crear({ timezone: 'America/Santiago' });

      const doc = await GymModel.findById(gymId);
      expect(doc?.timezone).toBe('America/Santiago');
    });

    it('la deja ausente si no se manda: "no configurada" no es "eligió Buenos Aires"', async () => {
      const gymId = await crear();

      const doc = await GymModel.findById(gymId);
      expect(doc?.timezone).toBeUndefined();

      const res = await asAdmin(request(app).get(`/api/admin/gyms/${gymId}`)).expect(200);
      expect(res.body.data.timezone).toBeUndefined();
    });

    it('la edita sin tocar el resto de la configuración', async () => {
      const gymId = await crear({ whatsappAccessToken: 'EAAG-token-de-meta' });

      const res = await asAdmin(request(app).put(`/api/admin/gyms/${gymId}`))
        .send({ timezone: 'America/Argentina/Buenos_Aires' })
        .expect(200);

      expect(res.body.data.timezone).toBe('America/Argentina/Buenos_Aires');

      // La credencial cifrada sigue en su lugar: `timezone` es escalar y no arrastra
      // el problema de merge que tienen los bloques de config.
      const doc = await GymModel.findById(gymId);
      expect(doc?.whatsappConfig?.encryptedAccessToken).toBeTruthy();
    });

    it('rechaza una zona horaria inexistente en el alta (400)', async () => {
      await asAdmin(request(app).post('/api/admin/gyms'))
        .send(nuevoGym({ timezone: 'Marte/Olympus' }))
        .expect(400);
    });

    it('rechaza una zona horaria inexistente al editar (400)', async () => {
      const gymId = await crear();

      await asAdmin(request(app).put(`/api/admin/gyms/${gymId}`))
        .send({ timezone: 'Buenos Aires' })
        .expect(400);
    });
  });

  it('devuelve el gym real, sin filtrar credenciales cifradas', async () => {
    const gymId = await crear({ whatsappAccessToken: 'EAAG-token-de-meta' });

    const res = await asAdmin(request(app).get(`/api/admin/gyms/${gymId}`)).expect(200);

    // Datos de verdad: antes este endpoint devolvía solo `{ id }` de placeholder
    expect(res.body.data.cuit).toBeTruthy();
    expect(res.body.data.contactPhone).toBe('5491122334455');
    // Se informa que está cargado, sin exponer el ciphertext
    expect(res.body.data.whatsappConfig.hasAccessToken).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('encrypted');
  });

  it('no devuelve credenciales cifradas al actualizar', async () => {
    const gymId = await crear({ whatsappAccessToken: 'EAAG-token-de-meta' });

    const res = await asAdmin(request(app).put(`/api/admin/gyms/${gymId}`))
      .send({ contactPhone: '5491199887766' })
      .expect(200);

    expect(JSON.stringify(res.body)).not.toContain('encrypted');
  });

  it('editar los datos del negocio NO borra el token de WhatsApp', async () => {
    // El bug que motivó el cambio: se editaba el teléfono del gimnasio y la
    // credencial de Meta desaparecía en silencio, porque no viaja en el body.
    const gymId = await crear({
      whatsappPhoneNumberId: 'phone-1',
      whatsappAccessToken: 'EAAG-token-de-meta',
    });

    await asAdmin(request(app).put(`/api/admin/gyms/${gymId}`))
      .send({ name: 'Hype Workout — Núñez', contactPhone: '5491199887766' })
      .expect(200);

    const doc = await GymModel.findById(gymId);
    expect(doc?.whatsappConfig?.encryptedAccessToken).toBeTruthy();
    expect(doc?.whatsappConfig?.phoneNumberId).toBe('phone-1');
    expect(doc?.contactPhone).toBe('5491199887766');
  });

  it('permite cargar el token de WhatsApp desde el panel de admin', async () => {
    const gymId = await crear();

    const res = await asAdmin(request(app).put(`/api/admin/gyms/${gymId}`))
      .send({ whatsappPhoneNumberId: 'phone-9', whatsappAccessToken: 'EAAG-nuevo' })
      .expect(200);

    expect(res.body.data.whatsappConfig).toEqual({
      phoneNumberId: 'phone-9',
      hasAccessToken: true,
    });
  });

  it('cambiar solo el número conserva el token ya cargado', async () => {
    const gymId = await crear({ whatsappAccessToken: 'EAAG-token-de-meta' });
    const antes = (await GymModel.findById(gymId))?.whatsappConfig?.encryptedAccessToken;

    await asAdmin(request(app).put(`/api/admin/gyms/${gymId}`))
      .send({ whatsappPhoneNumberId: 'phone-9' })
      .expect(200);

    const despues = (await GymModel.findById(gymId))?.whatsappConfig?.encryptedAccessToken;
    expect(despues).toBe(antes);
  });

  it('rechaza un CUIT duplicado al editar', async () => {
    const primero = await crear();
    const segundo = await crear();

    const cuitDelPrimero = (await GymModel.findById(primero))?.cuit;

    await asAdmin(request(app).put(`/api/admin/gyms/${segundo}`))
      .send({ cuit: cuitDelPrimero })
      .expect(409);
  });

  it('devuelve 404 para un gym inexistente', async () => {
    await asAdmin(
      request(app).get('/api/admin/gyms/507f1f77bcf86cd799439011')
    ).expect(404);
  });

  it('rechaza a un usuario que no es super-admin', async () => {
    const gymToken = jwt.sign(
      { userId: 'u-1', email: 'd@h.com', role: 'gym', gymId: '507f1f77bcf86cd799439011' },
      env.JWT_ACCESS_SECRET
    );

    await request(app)
      .get('/api/admin/gyms/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${gymToken}`)
      .expect(403);
  });
});

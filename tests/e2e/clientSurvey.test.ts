import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { GymModel } from '../../src/infrastructure/database/mongoose/schemas/GymSchema';

/**
 * Flujo real del dueño de gym: dar de alta un cliente con lo mínimo (nombre y
 * documento) y completarlo después con la encuesta, hasta dejarlo listo para
 * generar la rutina.
 */
describe('Alta mínima de cliente + carga de encuesta (e2e)', () => {
  let app: Application;

  const gymId = new Types.ObjectId().toString();
  const gymToken = jwt.sign(
    { userId: 'user-1', email: 'dueno@hype.com', role: 'gym', gymId },
    env.JWT_ACCESS_SECRET
  );

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${gymToken}`);

  beforeAll(async () => {
    app = await createApp();
  });

  it('crea el cliente solo con nombre y documento', async () => {
    const res = await auth(request(app).post('/api/clients'))
      .send({ nombre: 'Iván Bazán', documento: '40123456' })
      .expect(201);

    expect(res.body.data.nombre).toBe('Iván Bazán');
    expect(res.body.data.documento).toBe('40123456');
    expect(res.body.data.telefono).toBeUndefined();
    expect(res.body.data.encuestaData).toBeUndefined();

    // Fechas por defecto: 30 días de membresía
    const inicio = new Date(res.body.data.fechaInicio);
    const vencimiento = new Date(res.body.data.fechaVencimiento);
    const dias = Math.round((vencimiento.getTime() - inicio.getTime()) / 86400000);
    expect(dias).toBe(30);
  });

  it('completa la encuesta en dos tandas sin perder lo cargado antes', async () => {
    const created = await auth(request(app).post('/api/clients'))
      .send({ nombre: 'Iván Bazán', documento: '40123456' })
      .expect(201);

    const clientId = created.body.data.id;

    // Primera tanda: contacto + objetivos
    const primera = await auth(request(app).patch(`/api/clients/${clientId}/encuesta`))
      .send({
        telefono: '5491122334455',
        email: 'ivan@example.com',
        encuestaData: {
          objetivo: 'Ganar masa muscular',
          entrenamientos_por_semana: 4,
        },
      })
      .expect(200);

    expect(primera.body.data.telefono).toBe('5491122334455');
    expect(primera.body.data.email).toBe('ivan@example.com');
    expect(primera.body.data.encuestaData.objetivo).toBe('Ganar masa muscular');

    // Segunda tanda: datos que faltaban. No debe borrar los anteriores.
    const segunda = await auth(request(app).patch(`/api/clients/${clientId}/encuesta`))
      .send({
        encuestaData: {
          lesiones: 'Hombro derecho',
          experiencia: '2 años',
          objetivo: 'Fuerza', // pisa el anterior
        },
      })
      .expect(200);

    expect(segunda.body.data.encuestaData).toEqual({
      objetivo: 'Fuerza',
      entrenamientos_por_semana: 4,
      lesiones: 'Hombro derecho',
      experiencia: '2 años',
    });
    // El contacto cargado en la tanda anterior sigue en pie
    expect(segunda.body.data.telefono).toBe('5491122334455');
  });

  it('deja al cliente listo para generar la rutina', async () => {
    // GenerateRoutineUseCase valida el gym antes que la encuesta, así que el gym
    // del token tiene que existir para llegar al guard que nos interesa.
    await GymModel.create({
      _id: new Types.ObjectId(gymId),
      name: 'Hype Workout',
      businessName: 'Hype SRL',
      cuit: '30712345678',
      contactEmail: 'info@hype.com',
      contactPhone: '5491122334455',
      isActive: true,
      aiConfig: { provider: 'openai', promptTemplate: '{{respuestas_encuesta}}' },
      whatsappConfig: { phoneNumberId: '', tokenSecretRef: '' },
      pdfTemplate: {},
      googleFormConfig: {},
    });

    const created = await auth(request(app).post('/api/clients'))
      .send({ nombre: 'Sin Encuesta', documento: '40999999' })
      .expect(201);

    const clientId = created.body.data.id;

    // Sin encuesta, la generación se rechaza con el mensaje explicativo
    const sinEncuesta = await auth(
      request(app).post(`/api/routines/generate/${clientId}`)
    ).expect(400);

    expect(sinEncuesta.body.message).toContain('Client has no survey data');

    // Con encuesta cargada ya pasa la validación de datos: ahora se frena más
    // adelante, al no haber credencial de IA para este gym. Se comprueba por el
    // mensaje y no por el status, porque ambas paradas son 400.
    await auth(request(app).patch(`/api/clients/${clientId}/encuesta`))
      .send({ encuestaData: { objetivo: 'Hipertrofia' } })
      .expect(200);

    const conEncuesta = await auth(
      request(app).post(`/api/routines/generate/${clientId}`)
    );

    expect(conEncuesta.body.message).not.toContain('Client has no survey data');
    expect(conEncuesta.body.message).toContain('No AI API key configured');
  });

  it('rechaza una encuesta vacía (400)', async () => {
    const created = await auth(request(app).post('/api/clients'))
      .send({ nombre: 'Iván Bazán', documento: '40123456' })
      .expect(201);

    const res = await auth(
      request(app).patch(`/api/clients/${created.body.data.id}/encuesta`)
    )
      .send({ encuestaData: {} })
      .expect(400);

    expect(res.body.message).toBe('Validation failed');
  });

  it('no permite cargar la encuesta de un cliente de otro gym (404)', async () => {
    const created = await auth(request(app).post('/api/clients'))
      .send({ nombre: 'Iván Bazán', documento: '40123456' })
      .expect(201);

    const otroGymToken = jwt.sign(
      {
        userId: 'user-2',
        email: 'otro@gym.com',
        role: 'gym',
        gymId: new Types.ObjectId().toString(),
      },
      env.JWT_ACCESS_SECRET
    );

    await request(app)
      .patch(`/api/clients/${created.body.data.id}/encuesta`)
      .set('Authorization', `Bearer ${otroGymToken}`)
      .send({ encuestaData: { objetivo: 'Robar datos' } })
      .expect(404);
  });

  it('rechaza documento duplicado dentro del mismo gym (400)', async () => {
    await auth(request(app).post('/api/clients'))
      .send({ nombre: 'Primero', documento: '40123456' })
      .expect(201);

    await auth(request(app).post('/api/clients'))
      .send({ nombre: 'Segundo', documento: '40123456' })
      .expect(400);
  });
});

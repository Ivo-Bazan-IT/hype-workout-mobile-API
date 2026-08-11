import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';

/**
 * El embudo de punta a punta: alta del lead, contacto, conversión y KPIs.
 *
 * Lo que se verifica acá y no en los tests de caso de uso: que los dos sellos nuevos
 * —`fechaPrimerContacto` y `fechaConversion`— sobrevivan el viaje completo hasta la
 * base y vuelvan en el bloque `embudo` de `/api/dashboard/kpis`. Son campos que nadie
 * escribe a mano: si la ruta, el validador o el mapper se olvidan de uno, el
 * dashboard muestra un cero perfectamente creíble y nada falla a la vista.
 */
describe('Embudo de leads (e2e)', () => {
  let app: Application;

  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();

  const tokenDe = (gym: string) =>
    jwt.sign(
      { userId: 'user-1', email: 'dueno@hype.com', role: 'gym', gymId: gym },
      env.JWT_ACCESS_SECRET
    );

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${tokenDe(gymId)}`);

  beforeAll(async () => {
    app = await createApp();
  });

  /** Alta manual sin encuesta: eso es un lead en este CRM. */
  const crearLead = async (documento: string): Promise<string> => {
    const res = await auth(request(app).post('/api/clients'))
      .send({ nombre: 'Lucía Lead', documento })
      .expect(201);

    return res.body.data.id;
  };

  describe('POST /api/clients/:id/contacto', () => {
    it('sella el primer contacto', async () => {
      const clientId = await crearLead('41100001');

      const res = await auth(request(app).post(`/api/clients/${clientId}/contacto`))
        .send({})
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data.fechaPrimerContacto).toBeDefined();

      // Y quedó persistido, no solo devuelto en la respuesta.
      const ficha = await auth(request(app).get(`/api/clients/${clientId}`)).expect(200);
      expect(ficha.body.data.fechaPrimerContacto).toBe(
        res.body.data.fechaPrimerContacto
      );
    });

    it('es idempotente: el segundo llamado no corre la fecha', async () => {
      const clientId = await crearLead('41100002');

      const primero = await auth(request(app).post(`/api/clients/${clientId}/contacto`))
        .send({})
        .expect(200);

      const segundo = await auth(request(app).post(`/api/clients/${clientId}/contacto`))
        .send({})
        .expect(200);

      expect(segundo.body.data.fechaPrimerContacto).toBe(
        primero.body.data.fechaPrimerContacto
      );
    });

    it('honra la fecha explícita que manda el mostrador', async () => {
      const clientId = await crearLead('41100003');

      // El alta del propio lead: la fecha válida más atrás que existe para él. El
      // lead se creó hace milisegundos, así que cualquier otro instante pasado
      // caería antes de su alta y el caso de uso lo rechazaría con razón.
      const ficha = await auth(request(app).get(`/api/clients/${clientId}`)).expect(200);
      const fecha = ficha.body.data.createdAt;

      const res = await auth(request(app).post(`/api/clients/${clientId}/contacto`))
        .send({ fecha })
        .expect(200);

      expect(new Date(res.body.data.fechaPrimerContacto).toISOString()).toBe(
        new Date(fecha).toISOString()
      );
    });

    it('rechaza una fecha futura', async () => {
      const clientId = await crearLead('41100004');

      const res = await auth(request(app).post(`/api/clients/${clientId}/contacto`))
        .send({ fecha: new Date(Date.now() + 3_600_000).toISOString() })
        .expect(400);

      expect(res.body.status).toBe('error');
    });

    it('rechaza una fecha anterior al alta del lead', async () => {
      const clientId = await crearLead('41100005');

      await auth(request(app).post(`/api/clients/${clientId}/contacto`))
        .send({ fecha: '2020-01-01T00:00:00.000Z' })
        .expect(400);
    });

    it('no alcanza clientes de otro gym', async () => {
      const clientId = await crearLead('41100006');

      await request(app)
        .post(`/api/clients/${clientId}/contacto`)
        .set('Authorization', `Bearer ${tokenDe(otroGymId)}`)
        .send({})
        .expect(404);
    });
  });

  describe('conversión', () => {
    it('sella fechaConversion cuando el lead completa la encuesta', async () => {
      const clientId = await crearLead('41200001');

      const antes = await auth(request(app).get(`/api/clients/${clientId}`)).expect(200);
      expect(antes.body.data.fechaConversion).toBeUndefined();

      const res = await auth(request(app).patch(`/api/clients/${clientId}/encuesta`))
        .send({ encuestaData: { objetivo: 'Ganar masa muscular' } })
        .expect(200);

      expect(res.body.data.fechaConversion).toBeDefined();
    });

    it('completar la ficha en una segunda tanda no corre la conversión', async () => {
      const clientId = await crearLead('41200002');

      const primera = await auth(request(app).patch(`/api/clients/${clientId}/encuesta`))
        .send({ encuestaData: { objetivo: 'Fuerza' } })
        .expect(200);

      const segunda = await auth(request(app).patch(`/api/clients/${clientId}/encuesta`))
        .send({ encuestaData: { lesiones: 'Rodilla' } })
        .expect(200);

      expect(segunda.body.data.fechaConversion).toBe(primera.body.data.fechaConversion);
    });

    it('el alta que ya trae encuesta nace convertida', async () => {
      const res = await auth(request(app).post('/api/clients'))
        .send({
          nombre: 'Nace Convertido',
          documento: '41200003',
          encuestaData: { objetivo: 'Resistencia' },
        })
        .expect(201);

      expect(res.body.data.fechaConversion).toBeDefined();
    });
  });

  describe('GET /api/dashboard/kpis — bloque embudo', () => {
    it('cuenta los leads del mes, los contactos y las conversiones', async () => {
      const gymAislado = new Types.ObjectId().toString();
      const token = tokenDe(gymAislado);
      const como = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

      // Tres leads: uno convierte, uno solo se contacta, uno queda sin tocar.
      const convierte = await como(request(app).post('/api/clients'))
        .send({ nombre: 'Convierte', documento: '41300001' })
        .expect(201);
      const contactado = await como(request(app).post('/api/clients'))
        .send({ nombre: 'Contactado', documento: '41300002' })
        .expect(201);
      await como(request(app).post('/api/clients'))
        .send({ nombre: 'Olvidado', documento: '41300003' })
        .expect(201);

      await como(
        request(app).post(`/api/clients/${convierte.body.data.id}/contacto`)
      ).send({}).expect(200);
      await como(
        request(app).post(`/api/clients/${contactado.body.data.id}/contacto`)
      ).send({}).expect(200);
      await como(
        request(app).patch(`/api/clients/${convierte.body.data.id}/encuesta`)
      )
        .send({ encuestaData: { objetivo: 'Fuerza' } })
        .expect(200);

      const res = await como(request(app).get('/api/dashboard/kpis')).expect(200);
      const embudo = res.body.data.embudo;

      expect(embudo.leadsNuevos).toBe(3);
      expect(embudo.conversionesEnPeriodo).toBe(1);
      expect(embudo.sinConvertir).toBe(2);
      expect(embudo.sinContactar).toBe(1);
      expect(embudo.leadsPorSemana).toBeGreaterThan(0);
      expect(embudo.tiempoRespuestaMinutos).toBeGreaterThanOrEqual(0);
      // La cohorte del mes en curso nunca cumplió los 90 días: la tasa se censura
      // en vez de afirmar que los leads de esta semana ya fracasaron.
      expect(embudo.tasaConversion).toBeNull();
      expect(embudo.ventanaConversionDias).toBe(90);
    });

    it('no mezcla el embudo de otro gym', async () => {
      const gymVacio = new Types.ObjectId().toString();

      const res = await request(app)
        .get('/api/dashboard/kpis')
        .set('Authorization', `Bearer ${tokenDe(gymVacio)}`)
        .expect(200);

      expect(res.body.data.embudo.leadsNuevos).toBe(0);
      expect(res.body.data.embudo.conversionesEnPeriodo).toBe(0);
      expect(res.body.data.embudo.tasaConversion).toBeNull();
      expect(res.body.data.embudo.tiempoRespuestaMinutos).toBeNull();
    });
  });
});

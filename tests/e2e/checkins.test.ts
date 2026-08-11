import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';

/**
 * Registro de asistencia de punta a punta: molinete o mostrador contra la API real.
 *
 * Lo que se verifica acá y no en el test del caso de uso: que la ruta, el validador y
 * el tenant estén efectivamente cableados, y sobre todo que la idempotencia por día
 * sobreviva al viaje completo. Dos escaneos seguidos tienen que ser una sola visita —
 * si no, la frecuencia de visita, que es el predictor de churn más fuerte del
 * tablero, se duplica sin que nada falle a la vista.
 */
describe('Check-ins (e2e)', () => {
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

  /** Alta de socio por la API, que es lo que después habilita el check-in. */
  const crearSocio = async (documento: string): Promise<string> => {
    const res = await auth(request(app).post('/api/clients'))
      .send({ nombre: 'Socio de prueba', documento })
      .expect(201);

    return res.body.data.id;
  };

  describe('POST /api/checkins', () => {
    it('registra el ingreso del socio', async () => {
      const clientId = await crearSocio('40100001');

      const res = await auth(request(app).post('/api/checkins'))
        .send({ clientId })
        .expect(201);

      expect(res.body.status).toBe('success');
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.clientId).toBe(clientId);
      expect(res.body.data.gymId).toBe(gymId);
      expect(res.body.data.fecha).toBeDefined();
    });

    it('es idempotente por día: dos escaneos son una sola visita', async () => {
      const clientId = await crearSocio('40100002');

      const primero = await auth(request(app).post('/api/checkins'))
        .send({ clientId })
        .expect(201);

      const segundo = await auth(request(app).post('/api/checkins'))
        .send({ clientId })
        .expect(201);

      // Devuelve el mismo registro en vez de un conflicto: quien llama es un molinete
      // o el mostrador, y ahí un error sería ruido.
      expect(segundo.body.data.id).toBe(primero.body.data.id);

      const historial = await auth(request(app).get('/api/checkins')).expect(200);
      expect(historial.body.data.total).toBe(1);
    });

    it('registra días distintos como visitas distintas', async () => {
      const clientId = await crearSocio('40100003');

      await auth(request(app).post('/api/checkins'))
        .send({ clientId, fecha: new Date(2026, 2, 10, 9, 0).toISOString() })
        .expect(201);

      await auth(request(app).post('/api/checkins'))
        .send({ clientId, fecha: new Date(2026, 2, 11, 9, 0).toISOString() })
        .expect(201);

      const historial = await auth(request(app).get('/api/checkins')).expect(200);
      expect(historial.body.data.total).toBe(2);
    });

    it('acepta una fecha explícita para cargar a mano lo que no se registró en el momento', async () => {
      const clientId = await crearSocio('40100004');
      const fecha = new Date(2026, 2, 10, 19, 30);

      const res = await auth(request(app).post('/api/checkins'))
        .send({ clientId, fecha: fecha.toISOString() })
        .expect(201);

      expect(new Date(res.body.data.fecha)).toEqual(fecha);
    });

    it('registra el ingreso del socio vencido: entró, y es la señal de que volvió', async () => {
      const res = await auth(request(app).post('/api/clients'))
        .send({
          nombre: 'Socio Vencido',
          documento: '40100005',
          fechaInicio: '2025-01-01',
          fechaVencimiento: '2025-02-01',
        })
        .expect(201);

      await auth(request(app).post('/api/checkins'))
        .send({ clientId: res.body.data.id })
        .expect(201);
    });

    it('rechaza el check-in de un socio eliminado (400)', async () => {
      const clientId = await crearSocio('40100006');

      await auth(request(app).delete(`/api/clients/${clientId}`)).expect(200);

      const res = await auth(request(app).post('/api/checkins'))
        .send({ clientId })
        .expect(400);

      expect(res.body.message).toContain('inactive');
    });

    it('no permite registrar el ingreso de un socio de otro gym (404)', async () => {
      const clientId = await crearSocio('40100007');

      await request(app)
        .post('/api/checkins')
        .set('Authorization', `Bearer ${tokenDe(otroGymId)}`)
        .send({ clientId })
        .expect(404);
    });

    it('rechaza el alta sin clientId (400)', async () => {
      await auth(request(app).post('/api/checkins')).send({}).expect(400);
    });

    it('exige autenticación (401)', async () => {
      await request(app).post('/api/checkins').send({ clientId: 'x' }).expect(401);
    });
  });

  describe('GET /api/checkins', () => {
    it('filtra por socio', async () => {
      const uno = await crearSocio('40200001');
      const dos = await crearSocio('40200002');

      await auth(request(app).post('/api/checkins')).send({ clientId: uno }).expect(201);
      await auth(request(app).post('/api/checkins')).send({ clientId: dos }).expect(201);

      const res = await auth(request(app).get('/api/checkins').query({ clientId: uno })).expect(
        200
      );

      expect(res.body.data.total).toBe(1);
      expect(res.body.data.data[0].clientId).toBe(uno);
    });

    it('filtra por rango de fechas', async () => {
      const clientId = await crearSocio('40200003');

      for (const dia of [1, 10, 20]) {
        await auth(request(app).post('/api/checkins'))
          .send({ clientId, fecha: new Date(2026, 2, dia, 10, 0).toISOString() })
          .expect(201);
      }

      const res = await auth(
        request(app).get('/api/checkins').query({
          desde: new Date(2026, 2, 5).toISOString(),
          hasta: new Date(2026, 2, 15).toISOString(),
        })
      ).expect(200);

      expect(res.body.data.total).toBe(1);
    });

    it('pagina el historial', async () => {
      const clientId = await crearSocio('40200004');

      for (const dia of [1, 2, 3]) {
        await auth(request(app).post('/api/checkins'))
          .send({ clientId, fecha: new Date(2026, 2, dia, 10, 0).toISOString() })
          .expect(201);
      }

      const res = await auth(
        request(app).get('/api/checkins').query({ page: '1', limit: '2' })
      ).expect(200);

      expect(res.body.data.data).toHaveLength(2);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.totalPages).toBe(2);
    });

    /**
     * La paginación se valida en el borde y devuelve 400, no 500.
     *
     * Los tres casos terminaban en un error de servidor: `abc` producía `NaN` —que
     * pasaba la validación y llegaba a `.skip()`—, y `0` y `-5` producían un skip
     * negativo que Mongo rechaza. Son requests malformados del cliente, así que el
     * código que corresponde es 400.
     */
    describe('validación de la paginación', () => {
      it.each([
        ['page no numérico', { page: 'abc' }],
        ['page en cero', { page: '0' }],
        ['page negativo', { page: '-5' }],
        ['page decimal', { page: '1.5' }],
        ['limit no numérico', { limit: 'abc' }],
        ['limit en cero', { limit: '0' }],
        ['limit por encima del tope', { limit: '501' }],
      ])('rechaza %s con 400', async (_caso, query) => {
        const res = await auth(request(app).get('/api/checkins').query(query)).expect(400);

        expect(res.body.status).toBe('error');
      });

      it('acepta el limit máximo acordado con el front (500)', async () => {
        const res = await auth(
          request(app).get('/api/checkins').query({ limit: '500' })
        ).expect(200);

        expect(res.body.data.limit).toBe(500);
      });

      it('sin parámetros mantiene el default vigente: page 1, limit 20', async () => {
        const res = await auth(request(app).get('/api/checkins')).expect(200);

        expect(res.body.data.page).toBe(1);
        expect(res.body.data.limit).toBe(20);
      });
    });

    it('no muestra las asistencias de otro gym', async () => {
      const clientId = await crearSocio('40200005');
      await auth(request(app).post('/api/checkins')).send({ clientId }).expect(201);

      const res = await request(app)
        .get('/api/checkins')
        .set('Authorization', `Bearer ${tokenDe(otroGymId)}`)
        .expect(200);

      expect(res.body.data.total).toBe(0);
    });

    /**
     * El nombre del socio en cada fila.
     *
     * Sin esto la pantalla de asistencia es una lista de ObjectIds, y el front tenía
     * que cruzarla contra un padrón cacheado que podía no tener la fila.
     */
    it('incluye el nombre del socio en cada fila', async () => {
      const clientId = await crearSocio('40400001');
      await auth(request(app).post('/api/checkins')).send({ clientId }).expect(201);

      const res = await auth(request(app).get('/api/checkins').query({ clientId })).expect(
        200
      );

      expect(res.body.data.data[0].clientNombre).toBe('Socio de prueba');
      // Y sigue trayendo el id: el nombre se suma, no reemplaza.
      expect(res.body.data.data[0].clientId).toBe(clientId);
    });

    it('el nombre no rompe la paginación ni el filtrado por gym', async () => {
      const clientId = await crearSocio('40400002');

      for (const dia of [1, 2, 3]) {
        await auth(request(app).post('/api/checkins'))
          .send({ clientId, fecha: new Date(Date.UTC(2026, 4, dia, 13)).toISOString() })
          .expect(201);
      }

      const res = await auth(
        request(app).get('/api/checkins').query({ clientId, page: '1', limit: '2' })
      ).expect(200);

      expect(res.body.data.data).toHaveLength(2);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.totalPages).toBe(2);
      expect(res.body.data.data.every((f: { clientNombre: string }) => f.clientNombre)).toBe(
        true
      );
    });
  });

  /**
   * El mapa de calor: la semana del gimnasio en una grilla día × hora.
   *
   * Antes de este endpoint la gráfica no se podía construir de ninguna forma
   * razonable — un gym de 300 socios genera ~10.000 check-ins por trimestre y con el
   * `limit` por defecto de 20 eran 540 requests.
   */
  describe('GET /api/checkins/heatmap', () => {
    const pedirMapa = async (query: Record<string, string> = {}) => {
      const res = await auth(
        request(app).get('/api/checkins/heatmap').query(query)
      ).expect(200);
      return res.body.data;
    };

    it('devuelve la forma exacta que pidió el front', async () => {
      const mapa = await pedirMapa();

      expect(Object.keys(mapa).sort()).toEqual([
        'celdas',
        'desde',
        'hasta',
        'registroDesde',
        'zonaHoraria',
      ]);
    });

    it('la ruta /heatmap no se confunde con el listado', async () => {
      const mapa = await pedirMapa();

      // Si Express la matcheara contra otra ruta, esto vendría paginado.
      expect(mapa.celdas).toBeInstanceOf(Array);
      expect(mapa.total).toBeUndefined();
    });

    it('devuelve la zona horaria usada, aunque el gym no tenga una configurada', async () => {
      const mapa = await pedirMapa();

      // El default es aceptable justamente porque viaja en la respuesta: el front
      // rotula el eje con lo que se usó, no con lo que supone.
      expect(mapa.zonaHoraria).toBe('America/Argentina/Buenos_Aires');
    });

    it('manda las fechas de la ventana sin hora', async () => {
      const mapa = await pedirMapa();

      expect(mapa.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(mapa.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('un gym sin asistencias devuelve celdas vacías y registroDesde en null', async () => {
      const res = await request(app)
        .get('/api/checkins/heatmap')
        .set('Authorization', `Bearer ${tokenDe(otroGymId)}`)
        .expect(200);

      expect(res.body.data.celdas).toEqual([]);
      // `null`, no una fecha: el gym todavía no registraba asistencias, y esa banda
      // el front la raya en vez de pintarla como ceros reales.
      expect(res.body.data.registroDesde).toBeNull();
    });

    it('cuenta el ingreso de hoy en su franja, con el día en numeración ISO', async () => {
      const clientId = await crearSocio('40300001');
      await auth(request(app).post('/api/checkins')).send({ clientId }).expect(201);

      const mapa = await pedirMapa();

      expect(mapa.celdas.length).toBeGreaterThan(0);
      expect(mapa.registroDesde).not.toBeNull();

      for (const celda of mapa.celdas) {
        expect(celda.dia).toBeGreaterThanOrEqual(1);
        expect(celda.dia).toBeLessThanOrEqual(7);
        expect(celda.hora).toBeGreaterThanOrEqual(0);
        expect(celda.hora).toBeLessThanOrEqual(23);
        expect(celda.total).toBeGreaterThan(0);
      }
    });

    it('no cuenta las asistencias de otro gym', async () => {
      const clientId = await crearSocio('40300002');
      await auth(request(app).post('/api/checkins')).send({ clientId }).expect(201);

      const res = await request(app)
        .get('/api/checkins/heatmap')
        .set('Authorization', `Bearer ${tokenDe(otroGymId)}`)
        .expect(200);

      expect(res.body.data.celdas).toEqual([]);
    });

    describe('validación de `semanas`', () => {
      it.each([['0'], ['-1'], ['53'], ['abc'], ['2.5']])(
        'rechaza semanas=%s con 400',
        async (semanas) => {
          await auth(
            request(app).get('/api/checkins/heatmap').query({ semanas })
          ).expect(400);
        }
      );

      it('acepta el techo de 52', async () => {
        await pedirMapa({ semanas: '52' });
      });
    });

    it('exige autenticación (401)', async () => {
      await request(app).get('/api/checkins/heatmap').expect(401);
    });
  });
});

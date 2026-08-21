import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { INTERNAL_SECRET_HEADER } from '../../src/interfaces/http/middlewares/internalAuthMiddleware';

/**
 * El disparador interno de facturación, de punta a punta.
 *
 * Lo que se verifica acá y en ningún otro lado es el **montaje**: que la ruta haya
 * quedado del lado correcto del `authMiddleware` global. Es un equilibrio frágil y
 * de una sola línea en `routes/index.ts` — montarla más abajo la rompe (el cron no
 * tiene JWT y siempre daría 401), y montarla sin `internalAuthMiddleware` la deja
 * abierta a internet. Los dos errores son invisibles en un unit test del middleware.
 */
describe('Disparador interno de facturación (e2e)', () => {
  let app: Application;

  const RUTA = '/api/internal/jobs/emit-invoices';

  beforeAll(async () => {
    app = await createApp();
  });

  describe('puerta de entrada', () => {
    it('rechaza sin el header del secreto', async () => {
      const res = await request(app).post(RUTA);

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('error');
    });

    it('rechaza con un secreto equivocado', async () => {
      const res = await request(app).post(RUTA).set(INTERNAL_SECRET_HEADER, 'no-es-el-secreto');

      expect(res.status).toBe(401);
    });

    /*
     * Un JWT de admin no alcanza: son credenciales de otra superficie. Que esto dé
     * 401 confirma que la ruta no está compartiendo puerta con el resto de la API.
     */
    it('rechaza un JWT de admin sin el secreto interno', async () => {
      const jwt = await import('jsonwebtoken');
      const adminToken = jwt.default.sign(
        { userId: 'admin-1', email: 'admin@hype.com', role: 'admin' },
        env.JWT_ACCESS_SECRET
      );

      const res = await request(app).post(RUTA).set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(401);
    });
  });

  describe('con el secreto correcto', () => {
    const conSecreto = () =>
      request(app).post(RUTA).set(INTERNAL_SECRET_HEADER, env.INVOICE_CRON_SECRET!);

    /*
     * La afirmación de fondo: responde 200 SIN Authorization. Si alguien moviera el
     * `router.use('/internal', ...)` debajo del `authMiddleware`, este test se pone
     * en rojo con un 401 y el cron dejaría de emitir en producción sin avisar.
     */
    it('responde 200 sin JWT: la ruta está fuera del authMiddleware', async () => {
      const res = await conSecreto();

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('devuelve el resumen de la corrida', async () => {
      const res = await conSecreto();

      // Sin facturas pendientes en la base limpia, la corrida es un no-op honesto.
      expect(res.body.data).toEqual({
        procesadas: 0,
        emitidas: 0,
        fallidas: 0,
        truncado: false,
      });
    });

    it('es repetible: sin trabajo pendiente no falla ni acumula estado', async () => {
      await conSecreto().expect(200);
      const segunda = await conSecreto();

      expect(segunda.status).toBe(200);
      expect(segunda.body.data.procesadas).toBe(0);
    });
  });

  /*
   * El router interno solo define POST, así que un GET lo atraviesa sin handler y
   * cae en el `authMiddleware` global de más abajo: por eso 401 y no 404. Lo que
   * importa es que NO sea 200 — emitir facturas no puede dispararse con un GET,
   * que es lo que reintenta cualquier crawler o preflight.
   */
  it('no dispara el trabajo por GET, ni con el secreto correcto', async () => {
    const res = await request(app).get(RUTA).set(INTERNAL_SECRET_HEADER, env.INVOICE_CRON_SECRET!);

    expect(res.status).toBe(401);
  });
});

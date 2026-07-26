import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { RoutineModel } from '../../src/infrastructure/database/mongoose/schemas/RoutineSchema';
import { ClientModel } from '../../src/infrastructure/database/mongoose/schemas/ClientSchema';

/**
 * Descarga del PDF de una rutina.
 *
 * `routine.pdfUrl` es una ruta del filesystem del servidor, no una URL pública:
 * sin este endpoint el front no tenía forma de obtener el archivo.
 */
describe('Descarga del PDF de la rutina (e2e)', () => {
  let app: Application;
  let dirTemp: string;
  let rutaPdf: string;

  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();

  const gymToken = jwt.sign(
    { userId: 'user-1', email: 'dueno@hype.com', role: 'gym', gymId },
    env.JWT_ACCESS_SECRET
  );

  const asGym = (req: request.Test): request.Test =>
    req.set('Authorization', `Bearer ${gymToken}`);

  // PDF mínimo pero válido: alcanza para verificar que se sirve el binario
  const CONTENIDO_PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

  const crearRutina = async (overrides: Record<string, unknown> = {}) => {
    const client = await ClientModel.create({
      gymId: new Types.ObjectId(gymId),
      nombre: 'Iván Bazán',
      documento: `${Math.floor(Math.random() * 100000000)}`,
      fechaInicio: new Date(),
      fechaVencimiento: new Date(),
      estado: 'activo',
    });

    return RoutineModel.create({
      gymId: new Types.ObjectId(gymId),
      clientId: client._id,
      pdfUrl: rutaPdf,
      estadoGeneracion: 'generado',
      fechaVencimiento: new Date(),
      ...overrides,
    });
  };

  beforeAll(async () => {
    app = await createApp();
    dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'rutina-pdf-'));
    rutaPdf = path.join(dirTemp, 'rutina.pdf');
    fs.writeFileSync(rutaPdf, CONTENIDO_PDF);
  });

  afterAll(() => {
    fs.rmSync(dirTemp, { recursive: true, force: true });
  });

  it('sirve el PDF con el content-type correcto', async () => {
    const rutina = await crearRutina();

    const res = await asGym(request(app).get(`/api/routines/${rutina._id}/pdf`)).expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(res.body)).toEqual(CONTENIDO_PDF);
  });

  it('lo manda inline y con un nombre legible para el socio', async () => {
    const rutina = await crearRutina();

    const res = await asGym(request(app).get(`/api/routines/${rutina._id}/pdf`)).expect(200);

    // inline => el CRM puede previsualizarlo sin forzar la descarga
    expect(res.headers['content-disposition']).toContain('inline');
    // Sin tildes ni espacios: viaja dentro de un header entre comillas
    expect(res.headers['content-disposition']).toContain('rutina-Ivan-Bazan.pdf');
  });

  it('no sirve el PDF de una rutina de otro gym', async () => {
    // El caso que importa: sin filtrar por tenant, cualquier gimnasio podría
    // descargarse la rutina de un socio ajeno con solo tener el id
    const rutina = await crearRutina({ gymId: new Types.ObjectId(otroGymId) });

    await asGym(request(app).get(`/api/routines/${rutina._id}/pdf`)).expect(404);
  });

  it('devuelve 404 si la rutina existe pero todavía no tiene PDF', async () => {
    const rutina = await crearRutina({ pdfUrl: undefined, estadoGeneracion: 'error' });

    await asGym(request(app).get(`/api/routines/${rutina._id}/pdf`)).expect(404);
  });

  it('devuelve 404 si la rutina no existe', async () => {
    await asGym(
      request(app).get(`/api/routines/${new Types.ObjectId()}/pdf`)
    ).expect(404);
  });

  it('rechaza sin token', async () => {
    const rutina = await crearRutina();

    await request(app).get(`/api/routines/${rutina._id}/pdf`).expect(401);
  });
});

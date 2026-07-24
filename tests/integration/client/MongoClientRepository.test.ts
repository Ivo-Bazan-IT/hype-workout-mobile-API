import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { MongoClientRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoClientRepository';

/**
 * Test de integración contra Mongo en memoria (ver tests/setup.ts).
 *
 * Existe porque el bug que arreglamos vivía en el adaptador: `create()` armaba el
 * documento campo por campo y se olvidaba de `encuestaData`, así que las respuestas
 * de la encuesta se perdían en silencio. Un test de caso de uso con mocks no puede
 * detectar eso — el mock siempre "guarda" lo que le mandan.
 */
describe('MongoClientRepository (integración)', () => {
  const gymId = new Types.ObjectId().toString();

  const encuestaData = {
    '¿Cuál es tu objetivo?': ['Ganar masa muscular'],
    '¿Cuántos días podés entrenar?': '4',
    '¿Tenés alguna lesión?': 'Hombro derecho',
  };

  const baseClient = {
    gymId,
    nombre: 'Iván Bazán',
    documento: '40123456',
    telefono: '5491122334455',
    email: 'ivan@example.com',
    estado: 'pendiente' as const,
    fechaInicio: new Date('2026-07-01'),
    fechaVencimiento: new Date('2026-07-31'),
  };

  it('persiste encuestaData al crear el cliente', async () => {
    const repository = new MongoClientRepository();

    const created = await repository.create({ ...baseClient, encuestaData });

    expect(created.encuestaData).toEqual(encuestaData);

    // Releer de la base: lo que importa es que quedó guardado, no que lo devolvió el create
    const reloaded = await repository.findById(created.id, gymId);
    expect(reloaded?.encuestaData).toEqual(encuestaData);
  });

  it('crea el cliente sin encuestaData cuando el alta es manual', async () => {
    const repository = new MongoClientRepository();

    const created = await repository.create(baseClient);

    const reloaded = await repository.findById(created.id, gymId);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.encuestaData).toBeUndefined();
  });

  it('permite adjuntar encuestaData después por update', async () => {
    const repository = new MongoClientRepository();

    const created = await repository.create(baseClient);
    await repository.update(created.id, gymId, { encuestaData });

    const reloaded = await repository.findById(created.id, gymId);
    expect(reloaded?.encuestaData).toEqual(encuestaData);
  });

  it('no expone el cliente a otro gym (aislamiento multi-tenant)', async () => {
    const repository = new MongoClientRepository();
    const otroGymId = new Types.ObjectId().toString();

    const created = await repository.create({ ...baseClient, encuestaData });

    expect(await repository.findById(created.id, otroGymId)).toBeNull();
    expect(await repository.findByDocumento(baseClient.documento, otroGymId)).toBeNull();
  });
});

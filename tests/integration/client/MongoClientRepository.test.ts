import { describe, it, expect, beforeEach } from 'vitest';
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

  /**
   * El filtro por vencimiento es el que decide `clientesActivos` en el dashboard.
   *
   * Estaba declarado en `ClientSearchFilters` desde antes, pero `buildQuery` no lo
   * traducía: pasarlo no filtraba nada y tampoco fallaba. Un mock del puerto no puede
   * detectar eso —el mock "filtra" lo que le pidan—, así que el test va acá.
   */
  describe('filtro por vencimiento', () => {
    const rangoGymId = new Types.ObjectId().toString();

    // `tests/setup.ts` vacía las colecciones antes de cada test: el padrón se siembra
    // de nuevo cada vez.
    beforeEach(async () => {
      const repository = new MongoClientRepository();

      const padron: Array<[string, string]> = [
        ['60000001', '2026-04-01'], // vigente
        ['60000002', '2026-03-12'], // venció hace 3 días: dentro de la gracia
        ['60000003', '2026-02-03'], // venció hace 40 días: de baja
      ];

      for (const [documento, vencimiento] of padron) {
        await repository.create({
          ...baseClient,
          gymId: rangoGymId,
          documento,
          estado: 'activo',
          fechaVencimiento: new Date(`${vencimiento}T00:00:00.000Z`),
        });
      }
    });

    it('cuenta solo los que vencen desde la fecha dada', async () => {
      const repository = new MongoClientRepository();

      const activos = await repository.count(rangoGymId, {
        estado: 'activo',
        vencimientoDesde: new Date('2026-03-10T12:00:00.000Z'),
      });

      // El vigente y el que está en gracia. El de febrero no.
      expect(activos).toBe(2);
    });

    it('el borde es semiabierto: incluye desde, excluye hasta', async () => {
      const repository = new MongoClientRepository();

      const enRango = await repository.count(rangoGymId, {
        estado: 'activo',
        vencimientoDesde: new Date('2026-03-12T00:00:00.000Z'),
        vencimientoHasta: new Date('2026-04-01T00:00:00.000Z'),
      });

      // El del 12/03 entra por el `desde`; el del 01/04 queda afuera por el `hasta`.
      expect(enRango).toBe(1);
    });

    it('sin el filtro cuenta a todos, incluidos los vencidos', async () => {
      const repository = new MongoClientRepository();

      expect(await repository.count(rangoGymId, { estado: 'activo' })).toBe(3);
    });
  });
});

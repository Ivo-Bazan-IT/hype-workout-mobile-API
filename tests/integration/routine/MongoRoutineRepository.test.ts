import { describe, it, expect, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { MongoRoutineRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoRoutineRepository';
import { MongoClientRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoClientRepository';
import { ClientModel } from '../../../src/infrastructure/database/mongoose/schemas/ClientSchema';
import { RoutineModel } from '../../../src/infrastructure/database/mongoose/schemas/RoutineSchema';

/**
 * `search` contra Mongo real (en memoria, ver tests/setup.ts).
 *
 * Va acá y no en un unit test por dos razones que un mock del puerto no puede
 * detectar: el `$lookup` que resuelve el nombre del socio, y que el pipeline usa
 * `aggregate()` —donde Mongoose NO castea el `gymId` string a ObjectId, así que un
 * error ahí devuelve lista vacía sin fallar—.
 */
describe('MongoRoutineRepository.search (integración)', () => {
  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();

  let anaId: string;
  let brunoId: string;

  const crearRutina = async (input: {
    clientId: string;
    gym?: string;
    estadoEnvio?: 'pendiente' | 'enviando' | 'enviado' | 'error';
    estadoGeneracion?: 'pendiente' | 'generando' | 'generado' | 'error';
    fechaVencimiento?: string;
  }): Promise<void> => {
    await RoutineModel.create({
      gymId: new Types.ObjectId(input.gym ?? gymId),
      clientId: new Types.ObjectId(input.clientId),
      estadoGeneracion: input.estadoGeneracion ?? 'generado',
      estadoEnvio: input.estadoEnvio ?? 'enviado',
      fechaVencimiento: new Date(`${input.fechaVencimiento ?? '2026-09-01'}T00:00:00.000Z`),
    });
  };

  beforeEach(async () => {
    const clientRepository = new MongoClientRepository();

    const base = {
      gymId,
      telefono: '5491122334455',
      estado: 'activo' as const,
      fechaInicio: new Date('2026-07-01'),
      fechaVencimiento: new Date('2026-12-31'),
    };

    anaId = (
      await clientRepository.create({ ...base, nombre: 'Ana Pérez', documento: '70000001' })
    ).id;
    brunoId = (
      await clientRepository.create({ ...base, nombre: 'Bruno Díaz', documento: '70000002' })
    ).id;

    await crearRutina({ clientId: anaId, estadoEnvio: 'pendiente' });
    await crearRutina({ clientId: brunoId, estadoEnvio: 'enviado' });
  });

  it('devuelve las rutinas del gym con el nombre del socio resuelto', async () => {
    const repository = new MongoRoutineRepository();

    const result = await repository.search(gymId, {});

    expect(result.total).toBe(2);
    expect(result.data.map((r) => r.clientNombre).sort()).toEqual(['Ana Pérez', 'Bruno Díaz']);
  });

  it('no devuelve las rutinas de otro gym', async () => {
    const repository = new MongoRoutineRepository();

    await crearRutina({ clientId: anaId, gym: otroGymId });

    // El aislamiento tiene que sobrevivir al `aggregate`: si el gymId string no se
    // convierte a ObjectId, el `$match` no matchea nada y esto daría 0, no 2.
    const result = await repository.search(gymId, {});

    expect(result.total).toBe(2);
    expect(await repository.search(otroGymId, {})).toMatchObject({ total: 1 });
  });

  it('filtra por estado de envío sobre el gimnasio entero, no sobre una página', async () => {
    const repository = new MongoRoutineRepository();

    const pendientes = await repository.search(gymId, { estadoEnvio: 'pendiente' });

    expect(pendientes.total).toBe(1);
    expect(pendientes.data[0].clientNombre).toBe('Ana Pérez');
  });

  it('filtra por estado de generación', async () => {
    const repository = new MongoRoutineRepository();

    await crearRutina({ clientId: anaId, estadoGeneracion: 'error' });

    const conError = await repository.search(gymId, { estadoGeneracion: 'error' });

    expect(conError.total).toBe(1);
  });

  it('filtra por socio', async () => {
    const repository = new MongoRoutineRepository();

    const deAna = await repository.search(gymId, { clientId: anaId });

    expect(deAna.total).toBe(1);
    expect(deAna.data[0].clientId).toBe(anaId);
  });

  it('el rango de vencimiento es semiabierto: incluye desde, excluye hasta', async () => {
    const repository = new MongoRoutineRepository();

    await crearRutina({ clientId: anaId, fechaVencimiento: '2026-10-01' });

    const enRango = await repository.search(gymId, {
      vencimientoDesde: new Date('2026-09-01T00:00:00.000Z'),
      vencimientoHasta: new Date('2026-10-01T00:00:00.000Z'),
    });

    // Las dos del 01/09 entran; la del 01/10 queda afuera por el `hasta`.
    expect(enRango.total).toBe(2);
  });

  it('pagina y reporta el total del gimnasio, no el de la página', async () => {
    const repository = new MongoRoutineRepository();

    const primera = await repository.search(gymId, {}, 1, 1);

    expect(primera.data).toHaveLength(1);
    expect(primera.total).toBe(2);
    expect(primera.totalPages).toBe(2);

    const segunda = await repository.search(gymId, {}, 2, 1);

    expect(segunda.data).toHaveLength(1);
    expect(segunda.data[0].id).not.toBe(primera.data[0].id);
  });

  it('el socio borrado deja la fila con el nombre en null, no la hace desaparecer', async () => {
    const repository = new MongoRoutineRepository();

    // Borrado físico: el soft delete deja el documento y el lookup lo seguiría
    // encontrando. Lo que se prueba acá es el hueco real.
    await ClientModel.deleteOne({ _id: new Types.ObjectId(anaId) });

    const result = await repository.search(gymId, {});

    expect(result.total).toBe(2);
    const huerfana = result.data.find((r) => r.clientId === anaId);
    expect(huerfana).toBeDefined();
    expect(huerfana?.clientNombre).toBeNull();
  });
});

/**
 * `countExpiringWithin` contra Mongo real.
 *
 * Es el número de la tarjeta "rutinas por vencer" del dashboard, y su semántica no
 * se puede fijar con un mock del puerto: lo que se prueba es el rango de la query.
 * Antes contaba las que vencían EXACTAMENTE el día `days`-ésimo, así que una rutina
 * a 4 días no entraba en ninguno de los tres contadores (7, 5 y 3) y `en7Dias` no
 * incluía a `en3Dias`. La tarjeta no acumulaba.
 */
describe('MongoRoutineRepository.countExpiringWithin (integración)', () => {
  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();
  const clientId = new Types.ObjectId().toString();

  /** Una rutina que vence dentro de `dias` días, al mediodía para no pegarse a los bordes. */
  const rutinaQueVenceEn = async (dias: number, gym: string = gymId): Promise<void> => {
    const vence = new Date();
    vence.setDate(vence.getDate() + dias);
    vence.setHours(12, 0, 0, 0);

    await RoutineModel.create({
      gymId: new Types.ObjectId(gym),
      clientId: new Types.ObjectId(clientId),
      estadoGeneracion: 'generado',
      estadoEnvio: 'enviado',
      fechaVencimiento: vence,
    });
  };

  it('acumula: los tres contadores del dashboard se anidan', async () => {
    const repository = new MongoRoutineRepository();

    await rutinaQueVenceEn(2);
    await rutinaQueVenceEn(4);
    await rutinaQueVenceEn(6);

    // La de 4 días es la que antes no aparecía en ninguno de los tres.
    expect(await repository.countExpiringWithin(gymId, 3)).toBe(1);
    expect(await repository.countExpiringWithin(gymId, 5)).toBe(2);
    expect(await repository.countExpiringWithin(gymId, 7)).toBe(3);
  });

  it('cuenta la que vence hoy y no la que ya venció', async () => {
    const repository = new MongoRoutineRepository();

    await rutinaQueVenceEn(0); // hoy al mediodía
    await rutinaQueVenceEn(-1); // ayer

    // El piso es el arranque de HOY: una rutina que venció esta mañana sigue siendo
    // la que hay que renovar hoy; una de ayer ya no es un aviso, es un hecho.
    expect(await repository.countExpiringWithin(gymId, 3)).toBe(1);
  });

  it('no cuenta las de otro gimnasio', async () => {
    const repository = new MongoRoutineRepository();

    await rutinaQueVenceEn(2);
    await rutinaQueVenceEn(2, otroGymId);

    expect(await repository.countExpiringWithin(gymId, 7)).toBe(1);
  });

  it('no cuenta las que vencen después de la ventana', async () => {
    const repository = new MongoRoutineRepository();

    await rutinaQueVenceEn(8);

    expect(await repository.countExpiringWithin(gymId, 7)).toBe(0);
  });
});

describe('MongoRoutineRepository.delete (integración)', () => {
  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();
  const clientId = new Types.ObjectId().toString();

  it('borra el documento y devuelve true', async () => {
    const repository = new MongoRoutineRepository();
    const rutina = await RoutineModel.create({
      gymId: new Types.ObjectId(gymId),
      clientId: new Types.ObjectId(clientId),
      fechaVencimiento: new Date('2026-09-01'),
    });

    const borrada = await repository.delete(rutina.id, gymId);

    expect(borrada).toBe(true);
    expect(await RoutineModel.findById(rutina.id)).toBeNull();
  });

  it('no borra la rutina de otro gimnasio, y devuelve false', async () => {
    const repository = new MongoRoutineRepository();
    const rutina = await RoutineModel.create({
      gymId: new Types.ObjectId(gymId),
      clientId: new Types.ObjectId(clientId),
      fechaVencimiento: new Date('2026-09-01'),
    });

    const borrada = await repository.delete(rutina.id, otroGymId);

    expect(borrada).toBe(false);
    expect(await RoutineModel.findById(rutina.id)).not.toBeNull();
  });
});

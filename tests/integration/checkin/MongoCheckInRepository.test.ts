import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { MongoCheckInRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoCheckInRepository';
import { CheckInModel } from '../../../src/infrastructure/database/mongoose/schemas/CheckInSchema';
import { ClientModel } from '../../../src/infrastructure/database/mongoose/schemas/ClientSchema';
import { limitesDelDiaEn } from '../../../src/domain/time/zonaHoraria';

/**
 * Test de integración contra Mongo en memoria (ver tests/setup.ts).
 *
 * Lo que un mock no puede verificar acá: que `findByClientAndDay` recorte el día con
 * los límites correctos y que el filtro por `gymId` realmente aísle. De lo primero
 * depende la idempotencia del alta —dos escaneos del molinete tienen que ser una sola
 * visita— y con ella la frecuencia de visita, que es el predictor de churn más fuerte
 * del tablero.
 */
describe('MongoCheckInRepository (integración)', () => {
  const repository = new MongoCheckInRepository();

  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();
  const clientId = new Types.ObjectId().toString();
  const otroClientId = new Types.ObjectId().toString();

  /** Zona del gimnasio de estos tests. UTC-3 fijo: Argentina no aplica horario de verano. */
  const ZONA = 'America/Argentina/Buenos_Aires';

  /**
   * Instante UTC explícito.
   *
   * Estos tests NO pueden construir fechas con `new Date(y, m, d)`: eso las ancla a la
   * zona del proceso, y entonces el resultado dependería de si la suite corre en un
   * contenedor UTC o en una máquina argentina — que es exactamente el bug que este
   * módulo vino a cerrar. Un test que se mueve con el host no prueba nada.
   */
  const utc = (año: number, mes: number, dia: number, hora = 0, minuto = 0): Date =>
    new Date(Date.UTC(año, mes - 1, dia, hora, minuto));

  /** La hora de pared del gimnasio, convertida al instante UTC que le corresponde. */
  const enGym = (año: number, mes: number, dia: number, hora = 0, minuto = 0): Date =>
    utc(año, mes, dia, hora + 3, minuto);

  /** El día calendario del gimnasio que contiene ese instante. */
  const diaDe = (instante: Date): { start: Date; end: Date } =>
    limitesDelDiaEn(instante, ZONA);

  /** Fecha local, para los filtros de `search`, que reciben instantes sin recortar. */
  const local = (año: number, mes: number, dia: number, hora = 0, minuto = 0): Date =>
    new Date(año, mes - 1, dia, hora, minuto);

  describe('create', () => {
    it('persiste la asistencia y la devuelve mapeada al dominio', async () => {
      const fecha = local(2026, 3, 10, 9, 30);

      const creado = await repository.create({ gymId, clientId, fecha });

      expect(creado.id).toBeDefined();
      expect(creado.gymId).toBe(gymId);
      expect(creado.clientId).toBe(clientId);
      expect(creado.fecha).toEqual(fecha);

      // La hora se guarda completa: es lo que después permite leer las franjas pico.
      const enBase = await CheckInModel.findById(creado.id);
      expect(enBase!.fecha).toEqual(fecha);
    });
  });

  describe('findByClientAndDay', () => {
    it('encuentra la asistencia del día aunque se consulte a otra hora', async () => {
      await repository.create({ gymId, clientId, fecha: enGym(2026, 3, 10, 9, 30) });

      // El molinete vuelve a escanear a la tarde: es el mismo día, es la misma visita.
      const yaVino = await repository.findByClientAndDay(
        clientId,
        gymId,
        diaDe(enGym(2026, 3, 10, 19, 45))
      );

      expect(yaVino).not.toBeNull();
    });

    /**
     * La regresión que motivó todo el módulo de zona horaria.
     *
     * Las 21:30 de un lunes en Buenos Aires son las 00:30 del martes en UTC. Cuando el
     * día se recortaba con `setHours` sobre la hora del proceso y el server corría en
     * UTC, ese ingreso quedaba en el martes: el mismo socio volvía a escanear a las
     * 22:00 y se registraba una segunda visita. Con el corte en la zona del gimnasio,
     * los dos escaneos caen en el mismo día y son una sola visita.
     */
    it('trata la noche del gimnasio como un solo día, aunque en UTC ya sea el siguiente', async () => {
      const lunesALas2130 = enGym(2026, 3, 9, 21, 30);
      const lunesALas22 = enGym(2026, 3, 9, 22, 0);

      // Control: en UTC estos dos instantes ya son del martes.
      expect(lunesALas2130.getUTCDate()).toBe(10);

      await repository.create({ gymId, clientId, fecha: lunesALas2130 });

      const yaVino = await repository.findByClientAndDay(
        clientId,
        gymId,
        diaDe(lunesALas22)
      );

      expect(yaVino).not.toBeNull();
    });

    it('cubre el día completo, de la primera hora a la última', async () => {
      await repository.create({ gymId, clientId, fecha: enGym(2026, 3, 10, 0, 0) });
      await repository.create({
        gymId,
        clientId: otroClientId,
        fecha: enGym(2026, 3, 10, 23, 59),
      });

      expect(
        await repository.findByClientAndDay(clientId, gymId, diaDe(enGym(2026, 3, 10, 12)))
      ).not.toBeNull();
      expect(
        await repository.findByClientAndDay(
          otroClientId,
          gymId,
          diaDe(enGym(2026, 3, 10, 12))
        )
      ).not.toBeNull();
    });

    it('no confunde el día con el anterior ni con el siguiente', async () => {
      await repository.create({ gymId, clientId, fecha: enGym(2026, 3, 10, 9, 30) });

      expect(
        await repository.findByClientAndDay(clientId, gymId, diaDe(enGym(2026, 3, 9, 9, 30)))
      ).toBeNull();
      expect(
        await repository.findByClientAndDay(
          clientId,
          gymId,
          diaDe(enGym(2026, 3, 11, 9, 30))
        )
      ).toBeNull();
    });

    it('no cruza socios ni gyms', async () => {
      await repository.create({ gymId, clientId, fecha: enGym(2026, 3, 10, 9, 30) });

      expect(
        await repository.findByClientAndDay(otroClientId, gymId, diaDe(enGym(2026, 3, 10)))
      ).toBeNull();
      expect(
        await repository.findByClientAndDay(clientId, otroGymId, diaDe(enGym(2026, 3, 10)))
      ).toBeNull();
    });
  });

  describe('search', () => {
    /** Tres días de un socio y uno de otro, más uno de otro gym. */
    const sembrarHistorial = async (): Promise<void> => {
      await repository.create({ gymId, clientId, fecha: local(2026, 3, 1, 10) });
      await repository.create({ gymId, clientId, fecha: local(2026, 3, 10, 10) });
      await repository.create({ gymId, clientId, fecha: local(2026, 3, 20, 10) });
      await repository.create({ gymId, clientId: otroClientId, fecha: local(2026, 3, 15, 10) });
      await repository.create({ gymId: otroGymId, clientId, fecha: local(2026, 3, 10, 10) });
    };

    it('devuelve solo las asistencias del gym, más recientes primero', async () => {
      await sembrarHistorial();

      const resultado = await repository.search(gymId, {});

      expect(resultado.total).toBe(4);
      expect(resultado.data.map((c) => c.fecha)).toEqual([
        local(2026, 3, 20, 10),
        local(2026, 3, 15, 10),
        local(2026, 3, 10, 10),
        local(2026, 3, 1, 10),
      ]);
    });

    /**
     * El `$lookup` que resuelve el nombre del socio.
     *
     * Tiene una trampa que solo se ve contra Mongo: `search` pasó de `find()` a
     * `aggregate()`, y Mongoose castea los strings a ObjectId a partir del schema
     * SOLO en el primero. Un `gymId` como string dentro del `$match` de un pipeline
     * no matchea nada y devuelve una lista vacía sin ningún error — por eso estos
     * tests, que verifican que sigue filtrando, valen más que el del nombre.
     */
    describe('nombre del socio', () => {
      it('resuelve el nombre de cada fila', async () => {
        await ClientModel.create({
          _id: new Types.ObjectId(clientId),
          gymId: new Types.ObjectId(gymId),
          nombre: 'Iván Bazán',
          documento: '30111222',
          fechaInicio: new Date(Date.UTC(2026, 0, 1)),
          fechaVencimiento: new Date(Date.UTC(2026, 11, 31)),
        });

        await repository.create({ gymId, clientId, fecha: enGym(2026, 3, 10, 10) });

        const resultado = await repository.search(gymId, {});

        expect(resultado.data[0].clientNombre).toBe('Iván Bazán');
      });

      it('devuelve null si el socio ya no existe, sin perder la fila', async () => {
        await repository.create({ gymId, clientId, fecha: enGym(2026, 3, 10, 10) });

        const resultado = await repository.search(gymId, {});

        // La asistencia sigue siendo un hecho aunque el cliente se haya borrado.
        expect(resultado.total).toBe(1);
        expect(resultado.data[0].clientNombre).toBeNull();
      });
    });

    it('filtra por socio', async () => {
      await sembrarHistorial();

      const resultado = await repository.search(gymId, { clientId });

      expect(resultado.total).toBe(3);
      expect(resultado.data.every((c) => c.clientId === clientId)).toBe(true);
    });

    it('filtra por rango de fechas', async () => {
      await sembrarHistorial();

      const resultado = await repository.search(gymId, {
        desde: local(2026, 3, 5),
        hasta: local(2026, 3, 16),
      });

      expect(resultado.total).toBe(2);
      expect(resultado.data.map((c) => c.fecha)).toEqual([
        local(2026, 3, 15, 10),
        local(2026, 3, 10, 10),
      ]);
    });

    it('combina el filtro de socio con el de fechas', async () => {
      await sembrarHistorial();

      const resultado = await repository.search(gymId, {
        clientId,
        desde: local(2026, 3, 5),
      });

      expect(resultado.total).toBe(2);
      expect(resultado.data.every((c) => c.clientId === clientId)).toBe(true);
    });

    it('pagina y reporta el total sin paginar', async () => {
      await sembrarHistorial();

      const primera = await repository.search(gymId, {}, 1, 3);

      expect(primera.data).toHaveLength(3);
      expect(primera.total).toBe(4);
      expect(primera.page).toBe(1);
      expect(primera.totalPages).toBe(2);

      const segunda = await repository.search(gymId, {}, 2, 3);

      expect(segunda.data).toHaveLength(1);
      expect(segunda.data[0].fecha).toEqual(local(2026, 3, 1, 10));
    });

    it('devuelve vacío y no rompe cuando el gym no tiene asistencias', async () => {
      const resultado = await repository.search(gymId, {});

      expect(resultado.data).toEqual([]);
      expect(resultado.total).toBe(0);
      expect(resultado.totalPages).toBe(0);
    });
  });
});

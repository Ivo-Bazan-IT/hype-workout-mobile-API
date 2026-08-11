import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { MongoCheckInRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoCheckInRepository';

/**
 * El agrupado del mapa de calor, contra Mongo de verdad.
 *
 * Tiene que ser test de integración y no unitario: lo único que hay que verificar acá
 * es que el pipeline agrupe con la zona horaria correcta y con la numeración de día
 * correcta, y las dos cosas las resuelve Mongo. Un mock del puerto devolvería las
 * celdas que uno le diga y no probaría nada.
 */
describe('MongoCheckInRepository.getHeatmap (integración)', () => {
  const repository = new MongoCheckInRepository();

  const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

  /** Hora de pared del gimnasio (UTC-3) convertida al instante UTC que le corresponde. */
  const enGym = (año: number, mes: number, dia: number, hora: number, minuto = 0): Date =>
    new Date(Date.UTC(año, mes - 1, dia, hora + 3, minuto));

  /** Ventana amplia que contiene a todos los casos de este archivo. */
  const VENTANA = {
    start: new Date(Date.UTC(2026, 2, 1)),
    end: new Date(Date.UTC(2026, 3, 1)),
  };

  const celda = (celdas: Array<{ dia: number; hora: number; total: number }>, dia: number, hora: number) =>
    celdas.find((c) => c.dia === dia && c.hora === hora);

  /**
   * El requisito crítico del endpoint, y el test que no puede faltar.
   *
   * `CheckIn.fecha` es un instante. Agrupado en UTC, el pico real de las 19:00 en
   * Argentina aparece a las 22:00 y el mapa deja de responder la pregunta que vino a
   * responder: cuándo se llena el gimnasio.
   */
  it('agrupa por la hora del gimnasio, no por la de UTC', async () => {
    const gymId = new Types.ObjectId().toString();
    const clientId = new Types.ObjectId().toString();

    // Miércoles 11 de marzo de 2026, 19:30 en Buenos Aires = 22:30 UTC.
    const pico = enGym(2026, 3, 11, 19, 30);
    expect(pico.getUTCHours()).toBe(22);

    await repository.create({ gymId, clientId, fecha: pico });

    const celdas = await repository.getHeatmap(gymId, VENTANA, BUENOS_AIRES);

    expect(celdas).toHaveLength(1);
    expect(celdas[0].hora).toBe(19);
    expect(celdas[0].hora).not.toBe(22);
  });

  /**
   * El otro lugar donde el mapa sale corrido: Mongo tiene `$dayOfWeek` (1 = domingo)
   * y `$isoDayOfWeek` (1 = lunes). El contrato con el front es el segundo.
   */
  it('numera los días en ISO-8601: 1 = lunes, 7 = domingo', async () => {
    const gymId = new Types.ObjectId().toString();
    const clientId = new Types.ObjectId().toString();

    // 9 de marzo de 2026 es lunes; 15 de marzo es domingo.
    await repository.create({ gymId, clientId, fecha: enGym(2026, 3, 9, 10) });
    await repository.create({ gymId, clientId, fecha: enGym(2026, 3, 15, 10) });

    const celdas = await repository.getHeatmap(gymId, VENTANA, BUENOS_AIRES);

    expect(celda(celdas, 1, 10)?.total).toBe(1); // lunes
    expect(celda(celdas, 7, 10)?.total).toBe(1); // domingo
    // Con `$dayOfWeek` el domingo sería 1 y el lunes 2: ese es el bug que se evita.
    expect(celdas.map((c) => c.dia).sort()).toEqual([1, 7]);
  });

  it('un ingreso nocturno cuenta en el día del gimnasio, no en el de UTC', async () => {
    const gymId = new Types.ObjectId().toString();
    const clientId = new Types.ObjectId().toString();

    // Lunes 9 a las 22:00 en Buenos Aires = martes 10 a las 01:00 UTC.
    const nocturno = enGym(2026, 3, 9, 22);
    expect(nocturno.getUTCDate()).toBe(10);

    await repository.create({ gymId, clientId, fecha: nocturno });

    const celdas = await repository.getHeatmap(gymId, VENTANA, BUENOS_AIRES);

    expect(celdas[0].dia).toBe(1); // lunes, no martes
    expect(celdas[0].hora).toBe(22);
  });

  it('acumula los ingresos de la misma franja a lo largo de las semanas', async () => {
    const gymId = new Types.ObjectId().toString();

    // Tres miércoles distintos a las 19, con socios distintos.
    for (const dia of [11, 18, 25]) {
      await repository.create({
        gymId,
        clientId: new Types.ObjectId().toString(),
        fecha: enGym(2026, 3, dia, 19),
      });
    }

    const celdas = await repository.getHeatmap(gymId, VENTANA, BUENOS_AIRES);

    expect(celdas).toHaveLength(1);
    expect(celda(celdas, 3, 19)?.total).toBe(3); // miércoles
  });

  it('omite las celdas en cero: el resultado es disperso', async () => {
    const gymId = new Types.ObjectId().toString();

    await repository.create({
      gymId,
      clientId: new Types.ObjectId().toString(),
      fecha: enGym(2026, 3, 11, 19),
    });

    const celdas = await repository.getHeatmap(gymId, VENTANA, BUENOS_AIRES);

    // Una sola celda, no las 168 de la grilla completa.
    expect(celdas).toHaveLength(1);
  });

  it('respeta el rango semiabierto de la ventana', async () => {
    const gymId = new Types.ObjectId().toString();
    const clientId = new Types.ObjectId().toString();

    const ventana = {
      start: new Date(Date.UTC(2026, 2, 10)),
      end: new Date(Date.UTC(2026, 2, 12)),
    };

    await repository.create({ gymId, clientId, fecha: ventana.start }); // incluido
    await repository.create({ gymId, clientId, fecha: ventana.end }); // excluido

    const celdas = await repository.getHeatmap(gymId, ventana, BUENOS_AIRES);

    expect(celdas.reduce((t, c) => t + c.total, 0)).toBe(1);
  });

  it('no cuenta las asistencias de otro gym', async () => {
    const gymId = new Types.ObjectId().toString();
    const otroGymId = new Types.ObjectId().toString();

    await repository.create({
      gymId: otroGymId,
      clientId: new Types.ObjectId().toString(),
      fecha: enGym(2026, 3, 11, 19),
    });

    const celdas = await repository.getHeatmap(gymId, VENTANA, BUENOS_AIRES);

    expect(celdas).toEqual([]);
  });

  it('con el gym en otra zona la misma asistencia cae en otra franja', async () => {
    const gymId = new Types.ObjectId().toString();
    const clientId = new Types.ObjectId().toString();

    await repository.create({ gymId, clientId, fecha: enGym(2026, 3, 11, 19, 30) });

    const enUtc = await repository.getHeatmap(gymId, VENTANA, 'UTC');

    // El mismo instante, agrupado en UTC, es el bug que el endpoint evita.
    expect(enUtc[0].hora).toBe(22);
  });
});

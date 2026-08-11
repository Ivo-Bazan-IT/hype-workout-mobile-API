import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Types } from 'mongoose';
import {
  eventosDe,
  sembrarEventosDeMembresia,
} from '../../../src/scripts/seed-membership-events';
import { ClientModel } from '../../../src/infrastructure/database/mongoose/schemas/ClientSchema';
import { MembershipEventModel } from '../../../src/infrastructure/database/mongoose/schemas/MembershipEventSchema';
import { MongoMetricsRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoMetricsRepository';

/**
 * La siembra corre una sola vez por gym y escribe en un log que no se reescribe: un
 * evento inventado queda para siempre en los números del gimnasio. Por eso se
 * verifica contra Mongo en memoria antes de apuntarla a la base real.
 *
 * La línea que se está probando es la del criterio: **dato real o nada**. La ventana
 * vigente se siembra completa porque su inicio y su vencimiento constan; las
 * renovaciones pasadas se siembran con fecha y monto pero SIN vencimiento, porque ese
 * dato nunca se guardó. De ahí sale que los KPIs de plata tengan historia desde el día
 * uno y los de retención arranquen vacíos.
 */
describe('seed:membership-events (integración)', () => {
  const gymId = new Types.ObjectId();
  const otroGymId = new Types.ObjectId();

  beforeAll(() => {
    // La siembra reporta por consola; no ensucia la salida del test.
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  const crearCliente = async (input: {
    gymId?: Types.ObjectId;
    documento: string;
    fechaInicio: Date;
    fechaVencimiento: Date;
    estado?: 'activo' | 'inactivo' | 'pendiente';
    historialRenovaciones?: { fecha: Date; monto: number }[];
  }) =>
    ClientModel.create({
      gymId: input.gymId ?? gymId,
      nombre: `Socio ${input.documento}`,
      documento: input.documento,
      estado: input.estado ?? 'activo',
      fechaInicio: input.fechaInicio,
      fechaVencimiento: input.fechaVencimiento,
      historialRenovaciones: input.historialRenovaciones ?? [],
    });

  describe('eventosDe (armado de los eventos de un socio)', () => {
    const base = { _id: 'c1', gymId: 'g1' };

    it('el socio que nunca renovó aporta un alta con su ventana vigente', () => {
      const eventos = eventosDe({
        ...base,
        fechaInicio: new Date('2026-01-01'),
        fechaVencimiento: new Date('2026-02-01'),
      });

      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        tipo: 'alta',
        fecha: new Date('2026-01-01'),
        vencimientoNuevo: new Date('2026-02-01'),
        origen: 'historico',
      });
    });

    it('con renovaciones, el alta pierde el vencimiento y lo toma la última', () => {
      const eventos = eventosDe({
        ...base,
        fechaInicio: new Date('2025-10-01'),
        fechaVencimiento: new Date('2026-03-01'),
        historialRenovaciones: [
          { fecha: new Date('2025-11-01'), monto: 20000 },
          { fecha: new Date('2026-02-01'), monto: 25000 },
        ],
      });

      expect(eventos).toHaveLength(3);

      // El alta ya no es la ventana vigente: no se sabe a qué vencimiento llevó.
      expect(eventos[0].tipo).toBe('alta');
      expect(eventos[0].vencimientoNuevo).toBeUndefined();

      // Renovación intermedia: consta el cobro, no el vencimiento.
      expect(eventos[1]).toMatchObject({
        tipo: 'renovacion',
        fecha: new Date('2025-11-01'),
        monto: 20000,
      });
      expect(eventos[1].vencimientoNuevo).toBeUndefined();

      // La última sí: su vencimiento es el que el cliente tiene hoy.
      expect(eventos[2]).toMatchObject({
        tipo: 'renovacion',
        monto: 25000,
        vencimientoNuevo: new Date('2026-03-01'),
      });
    });

    it('ordena las renovaciones aunque el historial venga desordenado', () => {
      const eventos = eventosDe({
        ...base,
        fechaInicio: new Date('2025-10-01'),
        fechaVencimiento: new Date('2026-03-01'),
        historialRenovaciones: [
          { fecha: new Date('2026-02-01'), monto: 25000 },
          { fecha: new Date('2025-11-01'), monto: 20000 },
        ],
      });

      // Si tomara la última del array en vez de la más reciente, el vencimiento
      // vigente quedaría colgado de la renovación equivocada y la ventana actual
      // arrancaría tres meses antes.
      expect(eventos.map((e) => e.fecha)).toEqual([
        new Date('2025-10-01'),
        new Date('2025-11-01'),
        new Date('2026-02-01'),
      ]);
      expect(eventos[2].vencimientoNuevo).toEqual(new Date('2026-03-01'));
    });

    it('marca todo lo sembrado como histórico', () => {
      const eventos = eventosDe({
        ...base,
        fechaInicio: new Date('2025-10-01'),
        fechaVencimiento: new Date('2026-03-01'),
        historialRenovaciones: [{ fecha: new Date('2026-02-01'), monto: 25000 }],
      });

      // Es lo que después le dice a `getDataCutoff` que el historial previo a la
      // siembra no es confiable.
      expect(eventos.every((e) => e.origen === 'historico')).toBe(true);
    });
  });

  describe('sembrarEventosDeMembresia', () => {
    it('no hace nada si no hay clientes cargados', async () => {
      await sembrarEventosDeMembresia();

      expect(await MembershipEventModel.countDocuments({})).toBe(0);
    });

    it('siembra a todos los gyms de una pasada', async () => {
      await crearCliente({
        documento: '60000001',
        fechaInicio: new Date('2026-01-01'),
        fechaVencimiento: new Date('2026-02-01'),
      });
      await crearCliente({
        gymId: otroGymId,
        documento: '60000002',
        fechaInicio: new Date('2026-01-01'),
        fechaVencimiento: new Date('2026-02-01'),
      });

      await sembrarEventosDeMembresia();

      expect(await MembershipEventModel.countDocuments({ gymId })).toBe(1);
      expect(await MembershipEventModel.countDocuments({ gymId: otroGymId })).toBe(1);
    });

    it('es idempotente por gym: correrla dos veces no duplica nada', async () => {
      await crearCliente({
        documento: '60000003',
        fechaInicio: new Date('2026-01-01'),
        fechaVencimiento: new Date('2026-02-01'),
        historialRenovaciones: [{ fecha: new Date('2026-01-15'), monto: 20000 }],
      });

      await sembrarEventosDeMembresia();
      const despuesDeLaPrimera = await MembershipEventModel.countDocuments({ gymId });

      await sembrarEventosDeMembresia();

      expect(await MembershipEventModel.countDocuments({ gymId })).toBe(despuesDeLaPrimera);
    });

    it('saltea el gym ya sembrado pero siembra al que todavía no lo está', async () => {
      await crearCliente({
        documento: '60000004',
        fechaInicio: new Date('2026-01-01'),
        fechaVencimiento: new Date('2026-02-01'),
      });

      await sembrarEventosDeMembresia();

      // Un gym nuevo entra al sistema después de la primera corrida.
      await crearCliente({
        gymId: otroGymId,
        documento: '60000005',
        fechaInicio: new Date('2026-03-01'),
        fechaVencimiento: new Date('2026-04-01'),
      });

      await sembrarEventosDeMembresia();

      expect(await MembershipEventModel.countDocuments({ gymId })).toBe(1);
      expect(await MembershipEventModel.countDocuments({ gymId: otroGymId })).toBe(1);
    });

    it('no siembra a los socios eliminados', async () => {
      await crearCliente({
        documento: '60000006',
        fechaInicio: new Date('2026-01-01'),
        fechaVencimiento: new Date('2026-02-01'),
      });
      await crearCliente({
        documento: '60000007',
        estado: 'inactivo',
        fechaInicio: new Date('2026-01-01'),
        fechaVencimiento: new Date('2026-02-01'),
      });

      await sembrarEventosDeMembresia();

      // No son socios ni bajas: sembrarlos los haría aparecer como churn.
      expect(await MembershipEventModel.countDocuments({ gymId })).toBe(1);
    });

    it('deja el gym listo para que el dashboard cuente sus socios activos', async () => {
      // Es el punto entero de la siembra: sin ella el dashboard marcaría 0 activos el
      // día del deploy y los socios irían apareciendo de a uno al renovar.
      await crearCliente({
        documento: '60000008',
        fechaInicio: new Date('2026-01-01'),
        fechaVencimiento: new Date('2027-01-01'),
        historialRenovaciones: [{ fecha: new Date('2026-06-01'), monto: 25000 }],
      });

      await sembrarEventosDeMembresia();

      const repository = new MongoMetricsRepository();
      const [historial] = await repository.getMembershipHistories(gymId.toString());

      expect(historial.fechaAlta).toEqual(new Date('2026-01-01'));
      // Una sola ventana, la vigente: la del alta no tiene vencimiento porque hubo
      // renovación posterior, así que no dibuja tramo.
      expect(historial.windows).toHaveLength(1);
      expect(historial.windows[0]).toMatchObject({
        inicio: new Date('2026-06-01'),
        vencimiento: new Date('2027-01-01'),
        monto: 2500000, // pesos → centavos
      });
      // El cobro histórico entra a los ingresos aunque su ventana no exista.
      expect(historial.pagos).toEqual([
        { fecha: new Date('2026-06-01'), monto: 2500000 },
      ]);
    });

    it('marca el corte de datos en el momento de la siembra, no en la fecha de los eventos', async () => {
      await crearCliente({
        documento: '60000009',
        fechaInicio: new Date('2024-01-01'),
        fechaVencimiento: new Date('2027-01-01'),
      });

      await sembrarEventosDeMembresia();

      const corte = await new MongoMetricsRepository().getDataCutoff(gymId.toString());

      // Antes del corte los KPIs de retención viajan en `null`: las renovaciones
      // previas se cargaron sin vencimiento y no se puede afirmar quién estaba activo.
      expect(corte).not.toBeNull();
      expect(corte!.getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());
    });
  });
});

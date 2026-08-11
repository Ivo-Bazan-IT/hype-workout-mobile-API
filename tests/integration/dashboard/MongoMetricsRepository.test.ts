import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { MongoMetricsRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoMetricsRepository';
import { ClientModel } from '../../../src/infrastructure/database/mongoose/schemas/ClientSchema';
import { MembershipEventModel } from '../../../src/infrastructure/database/mongoose/schemas/MembershipEventSchema';
import { CheckInModel } from '../../../src/infrastructure/database/mongoose/schemas/CheckInSchema';

/**
 * Test de integración contra Mongo en memoria (ver tests/setup.ts).
 *
 * Existe porque `getMembershipHistories` es un pipeline de agregación con `$sort`,
 * `$group` y `$lookup`: por definición, un mock no ejercita nada de eso. Si el
 * `$lookup` apunta a una colección mal nombrada, si el `$match` de soft delete no
 * filtra lo que cree filtrar, o si el orden de los eventos no sobrevive al `$group`,
 * un test de caso de uso con mocks lo deja pasar y el dashboard miente en producción.
 */
describe('MongoMetricsRepository (integración)', () => {
  const repository = new MongoMetricsRepository();

  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();

  /** Crea un socio real: el pipeline hace `$lookup` contra esta colección. */
  const crearCliente = async (input: {
    gymId?: string;
    estado?: 'activo' | 'inactivo' | 'pendiente';
  } = {}): Promise<string> => {
    const doc = await ClientModel.create({
      gymId: new Types.ObjectId(input.gymId ?? gymId),
      nombre: 'Socio de prueba',
      documento: String(Math.floor(Math.random() * 1e8)),
      estado: input.estado ?? 'activo',
      fechaInicio: new Date('2026-01-01'),
      fechaVencimiento: new Date('2026-02-01'),
    });

    return doc._id.toString();
  };

  const evento = (input: {
    clientId: string;
    gymId?: string;
    tipo?: 'alta' | 'renovacion' | 'ajuste';
    fecha: Date;
    monto?: number;
    vencimientoNuevo?: Date;
    origen?: 'operacion' | 'historico';
  }) => ({
    gymId: new Types.ObjectId(input.gymId ?? gymId),
    clientId: new Types.ObjectId(input.clientId),
    tipo: input.tipo ?? 'renovacion',
    fecha: input.fecha,
    monto: input.monto,
    vencimientoNuevo: input.vencimientoNuevo,
    origen: input.origen ?? 'operacion',
  });

  describe('getMembershipHistories', () => {
    it('agrupa los eventos por socio y ordena aunque se hayan insertado al revés', async () => {
      const clientId = await crearCliente();

      // A propósito desordenados: `fechaAlta` sale de `eventos[0]`, así que si el
      // `$sort` previo al `$group` no se reflejara en el `$push`, el alta del socio
      // quedaría siendo su última renovación.
      await MembershipEventModel.insertMany([
        evento({
          clientId,
          tipo: 'renovacion',
          fecha: new Date('2026-03-01'),
          monto: 30000,
          vencimientoNuevo: new Date('2026-04-01'),
        }),
        evento({
          clientId,
          tipo: 'alta',
          fecha: new Date('2026-01-01'),
          vencimientoNuevo: new Date('2026-02-01'),
        }),
        evento({
          clientId,
          tipo: 'renovacion',
          fecha: new Date('2026-02-01'),
          monto: 25000,
          vencimientoNuevo: new Date('2026-03-01'),
        }),
      ]);

      const [historial] = await repository.getMembershipHistories(gymId);

      expect(historial.clientId).toBe(clientId);
      expect(historial.fechaAlta).toEqual(new Date('2026-01-01'));
      expect(historial.windows.map((w) => w.inicio)).toEqual([
        new Date('2026-01-01'),
        new Date('2026-02-01'),
        new Date('2026-03-01'),
      ]);
    });

    it('convierte los montos de pesos a centavos enteros', async () => {
      const clientId = await crearCliente();

      await MembershipEventModel.insertMany([
        evento({
          clientId,
          tipo: 'alta',
          fecha: new Date('2026-01-01'),
          monto: 15000.5,
          vencimientoNuevo: new Date('2026-02-01'),
        }),
      ]);

      const [historial] = await repository.getMembershipHistories(gymId);

      // La base guarda pesos; el dominio razona en centavos y no sabe de la conversión.
      expect(historial.pagos).toEqual([
        { fecha: new Date('2026-01-01'), monto: 1500050 },
      ]);
      expect(historial.windows[0].monto).toBe(1500050);
    });

    it('registra el cobro sin dibujar ventana cuando la renovación no tiene vencimiento', async () => {
      const clientId = await crearCliente();

      await MembershipEventModel.insertMany([
        // Renovación histórica sembrada: se conoce el cobro, no hasta cuándo extendió.
        evento({
          clientId,
          fecha: new Date('2026-01-01'),
          monto: 20000,
          origen: 'historico',
        }),
        evento({
          clientId,
          fecha: new Date('2026-02-01'),
          monto: 22000,
          vencimientoNuevo: new Date('2026-03-01'),
          origen: 'historico',
        }),
      ]);

      const [historial] = await repository.getMembershipHistories(gymId);

      // Dos pagos (la historia de ingresos es real), una sola ventana: sin
      // vencimiento no se puede afirmar que hubo continuidad, y estimarla sería
      // inventar churn.
      expect(historial.pagos).toHaveLength(2);
      expect(historial.windows).toHaveLength(1);
      expect(historial.windows[0].vencimiento).toEqual(new Date('2026-03-01'));
    });

    it('deja fuera al socio eliminado, que es borrado lógico y no una baja', async () => {
      const vigente = await crearCliente({ estado: 'activo' });
      const eliminado = await crearCliente({ estado: 'inactivo' });

      await MembershipEventModel.insertMany([
        evento({ clientId: vigente, tipo: 'alta', fecha: new Date('2026-01-01') }),
        evento({ clientId: eliminado, tipo: 'alta', fecha: new Date('2026-01-01') }),
      ]);

      const historiales = await repository.getMembershipHistories(gymId);

      expect(historiales).toHaveLength(1);
      expect(historiales[0].clientId).toBe(vigente);
    });

    it('deja fuera los eventos cuyo cliente ya no existe', async () => {
      const huerfano = new Types.ObjectId().toString();

      await MembershipEventModel.insertMany([
        evento({ clientId: huerfano, tipo: 'alta', fecha: new Date('2026-01-01') }),
      ]);

      // El `$lookup` no encuentra nada y el `$match` lo descarta: sin ese filtro, el
      // `aHistorial` seguiría adelante y el socio fantasma contaría como alta.
      expect(await repository.getMembershipHistories(gymId)).toEqual([]);
    });

    it('no mezcla el historial de otro gym (aislamiento multi-tenant)', async () => {
      const propio = await crearCliente();
      const ajeno = await crearCliente({ gymId: otroGymId });

      await MembershipEventModel.insertMany([
        evento({ clientId: propio, tipo: 'alta', fecha: new Date('2026-01-01') }),
        evento({ clientId: ajeno, gymId: otroGymId, tipo: 'alta', fecha: new Date('2026-01-01') }),
      ]);

      const historiales = await repository.getMembershipHistories(gymId);

      expect(historiales).toHaveLength(1);
      expect(historiales[0].clientId).toBe(propio);
    });

    it('devuelve un historial por socio y no uno por evento', async () => {
      const uno = await crearCliente();
      const dos = await crearCliente();

      await MembershipEventModel.insertMany([
        evento({ clientId: uno, tipo: 'alta', fecha: new Date('2026-01-01') }),
        evento({ clientId: uno, fecha: new Date('2026-02-01'), monto: 10000 }),
        evento({ clientId: dos, tipo: 'alta', fecha: new Date('2026-01-15') }),
      ]);

      const historiales = await repository.getMembershipHistories(gymId);

      expect(historiales).toHaveLength(2);
    });
  });

  describe('getDataCutoff', () => {
    it('devuelve null cuando el gym no tiene ningún evento', async () => {
      expect(await repository.getDataCutoff(gymId)).toBeNull();
    });

    it('usa la fecha del primer evento cuando el gym nunca se sembró', async () => {
      const clientId = await crearCliente();

      await MembershipEventModel.insertMany([
        evento({ clientId, tipo: 'alta', fecha: new Date('2026-02-10') }),
        evento({ clientId, fecha: new Date('2026-03-10'), monto: 10000 }),
      ]);

      // Todo se registró en el momento, así que el stream es completo desde el arranque.
      expect(await repository.getDataCutoff(gymId)).toEqual(new Date('2026-02-10'));
    });

    it('usa el instante de la siembra cuando el gym tiene eventos históricos', async () => {
      const clientId = await crearCliente();

      await MembershipEventModel.insertMany([
        evento({
          clientId,
          tipo: 'alta',
          fecha: new Date('2025-05-01'),
          origen: 'historico',
        }),
      ]);

      const corte = await repository.getDataCutoff(gymId);

      // No es la fecha del evento (2025) sino cuándo se sembró: antes de eso las
      // renovaciones se cargaron sin vencimiento y no se sabe quién estaba activo.
      expect(corte).not.toBeNull();
      expect(corte!.getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());
    });

    it('no toma el corte de otro gym', async () => {
      const ajeno = await crearCliente({ gymId: otroGymId });

      await MembershipEventModel.insertMany([
        evento({ clientId: ajeno, gymId: otroGymId, tipo: 'alta', fecha: new Date('2026-01-01') }),
      ]);

      expect(await repository.getDataCutoff(gymId)).toBeNull();
    });
  });

  describe('check-ins', () => {
    const checkIn = (clientId: string, fecha: Date, gym: string = gymId) => ({
      gymId: new Types.ObjectId(gym),
      clientId: new Types.ObjectId(clientId),
      fecha,
    });

    it('cuenta las asistencias del rango como semiabierto [desde, hasta)', async () => {
      const clientId = await crearCliente();

      await CheckInModel.insertMany([
        checkIn(clientId, new Date('2026-02-28T10:00:00Z')), // antes: fuera
        checkIn(clientId, new Date('2026-03-01T10:00:00Z')), // el borde inicial entra
        checkIn(clientId, new Date('2026-03-15T10:00:00Z')),
        checkIn(clientId, new Date('2026-04-01T00:00:00Z')), // el borde final NO entra
      ]);

      const total = await repository.countCheckIns(gymId, {
        start: new Date('2026-03-01T00:00:00Z'),
        end: new Date('2026-04-01T00:00:00Z'),
      });

      expect(total).toBe(2);
    });

    it('no cuenta las asistencias de otro gym', async () => {
      const ajeno = await crearCliente({ gymId: otroGymId });

      await CheckInModel.insertMany([
        checkIn(ajeno, new Date('2026-03-05T10:00:00Z'), otroGymId),
      ]);

      const total = await repository.countCheckIns(gymId, {
        start: new Date('2026-03-01'),
        end: new Date('2026-04-01'),
      });

      expect(total).toBe(0);
    });

    it('devuelve la última asistencia de cada socio', async () => {
      const uno = await crearCliente();
      const dos = await crearCliente();

      await CheckInModel.insertMany([
        checkIn(uno, new Date('2026-03-01T10:00:00Z')),
        checkIn(uno, new Date('2026-03-20T10:00:00Z')),
        checkIn(uno, new Date('2026-03-10T10:00:00Z')),
        checkIn(dos, new Date('2026-03-05T10:00:00Z')),
      ]);

      const ultimas = await repository.getLastCheckInByClient(gymId);
      const porSocio = new Map(ultimas.map((u) => [u.clientId, u.lastCheckInAt]));

      expect(ultimas).toHaveLength(2);
      expect(porSocio.get(uno)).toEqual(new Date('2026-03-20T10:00:00Z'));
      expect(porSocio.get(dos)).toEqual(new Date('2026-03-05T10:00:00Z'));
    });

    it('omite a los socios que nunca asistieron', async () => {
      const vino = await crearCliente();
      await crearCliente(); // nunca registró asistencia

      await CheckInModel.insertMany([checkIn(vino, new Date('2026-03-01T10:00:00Z'))]);

      const ultimas = await repository.getLastCheckInByClient(gymId);

      // El caso de uso los completa con `null`, que es el riesgo más alto.
      expect(ultimas).toHaveLength(1);
      expect(ultimas[0].clientId).toBe(vino);
    });

    it('devuelve null como primera asistencia cuando el gym nunca registró ninguna', async () => {
      expect(await repository.getFirstCheckInDate(gymId)).toBeNull();
    });

    it('devuelve la primera asistencia registrada del gym', async () => {
      const clientId = await crearCliente();

      await CheckInModel.insertMany([
        checkIn(clientId, new Date('2026-03-10T10:00:00Z')),
        checkIn(clientId, new Date('2026-03-02T08:00:00Z')),
        checkIn(clientId, new Date('2026-03-20T10:00:00Z')),
      ]);

      expect(await repository.getFirstCheckInDate(gymId)).toEqual(
        new Date('2026-03-02T08:00:00Z')
      );
    });
  });

  describe('embudo', () => {
    const MARZO = { start: new Date('2026-03-01'), end: new Date('2026-04-01') };

    /**
     * Un lead con su alta antedatada.
     *
     * El `createdAt` se corrige por el driver crudo (`.collection`) y no con
     * `ClientModel.updateOne`: Mongoose marca `createdAt` como **inmutable** cuando
     * el schema usa `timestamps`, así que un `$set` por el modelo se descarta sin
     * error y sin aviso. Sin esta segunda escritura, todos los leads del test
     * nacerían hoy y la cohorte de marzo saldría vacía.
     */
    const crearLead = async (input: {
      createdAt: Date;
      gymId?: string;
      estado?: 'activo' | 'inactivo' | 'pendiente';
      encuestaData?: Record<string, unknown>;
      fechaConversion?: Date;
      fechaPrimerContacto?: Date;
    }): Promise<string> => {
      const doc = await ClientModel.create({
        gymId: new Types.ObjectId(input.gymId ?? gymId),
        nombre: 'Lead de prueba',
        documento: String(Math.floor(Math.random() * 1e8)),
        estado: input.estado ?? 'activo',
        fechaInicio: input.createdAt,
        fechaVencimiento: new Date('2026-12-01'),
        encuestaData: input.encuestaData,
        fechaConversion: input.fechaConversion,
        fechaPrimerContacto: input.fechaPrimerContacto,
      });

      await ClientModel.collection.updateOne(
        { _id: doc._id },
        { $set: { createdAt: input.createdAt } }
      );

      return doc._id.toString();
    };

    describe('getLeadCohort', () => {
      it('trae solo las altas del rango, semiabierto por derecha', async () => {
        await crearLead({ createdAt: new Date('2026-02-28T23:00:00Z') });
        const dentro = await crearLead({ createdAt: new Date('2026-03-15T10:00:00Z') });
        await crearLead({ createdAt: new Date('2026-04-01T00:00:00Z') });

        const cohorte = await repository.getLeadCohort(gymId, MARZO);

        expect(cohorte.map((l) => l.clientId)).toEqual([dentro]);
      });

      it('no filtra por otro gym ni trae eliminados', async () => {
        const propio = await crearLead({ createdAt: new Date('2026-03-05') });
        await crearLead({ createdAt: new Date('2026-03-06'), gymId: otroGymId });
        // Soft delete: un alta cargada por error no es un lead que se perdió.
        await crearLead({ createdAt: new Date('2026-03-07'), estado: 'inactivo' });

        const cohorte = await repository.getLeadCohort(gymId, MARZO);

        expect(cohorte.map((l) => l.clientId)).toEqual([propio]);
      });

      it('marca convertido a quien tiene encuesta, con fecha o sin ella', async () => {
        const conFecha = await crearLead({
          createdAt: new Date('2026-03-02'),
          encuestaData: { objetivo: 'Fuerza' },
          fechaConversion: new Date('2026-03-03'),
        });
        // Anterior a la tanda 4: convirtió, pero nadie registró cuándo.
        const sinFecha = await crearLead({
          createdAt: new Date('2026-03-04'),
          encuestaData: { objetivo: 'Resistencia' },
        });
        const pendiente = await crearLead({ createdAt: new Date('2026-03-06') });

        const cohorte = await repository.getLeadCohort(gymId, MARZO);
        const porId = new Map(cohorte.map((l) => [l.clientId, l]));

        expect(porId.get(conFecha)!.convertido).toBe(true);
        expect(porId.get(conFecha)!.fechaConversion).toEqual(new Date('2026-03-03'));
        expect(porId.get(sinFecha)!.convertido).toBe(true);
        expect(porId.get(sinFecha)!.fechaConversion).toBeNull();
        expect(porId.get(pendiente)!.convertido).toBe(false);
      });

      it('no cuenta como conversión una encuesta vacía', async () => {
        await crearLead({ createdAt: new Date('2026-03-02'), encuestaData: {} });

        const [lead] = await repository.getLeadCohort(gymId, MARZO);

        expect(lead.convertido).toBe(false);
      });

      it('normaliza a null los campos ausentes, que Mongoose devuelve undefined', async () => {
        await crearLead({ createdAt: new Date('2026-03-02') });

        const [lead] = await repository.getLeadCohort(gymId, MARZO);

        expect(lead.fechaPrimerContacto).toBeNull();
        expect(lead.fechaConversion).toBeNull();
      });

      it('devuelve el primer contacto cuando está registrado', async () => {
        await crearLead({
          createdAt: new Date('2026-03-02T10:00:00Z'),
          fechaPrimerContacto: new Date('2026-03-02T10:30:00Z'),
        });

        const [lead] = await repository.getLeadCohort(gymId, MARZO);

        expect(lead.fechaPrimerContacto).toEqual(new Date('2026-03-02T10:30:00Z'));
      });
    });

    describe('countConversions', () => {
      it('cuenta por fecha de conversión y no por fecha de alta', async () => {
        // Lead de enero que recién en marzo contestó: conversión de marzo.
        await crearLead({
          createdAt: new Date('2026-01-10'),
          encuestaData: { objetivo: 'Fuerza' },
          fechaConversion: new Date('2026-03-20'),
        });
        // Alta de marzo que convirtió en abril: no es de marzo.
        await crearLead({
          createdAt: new Date('2026-03-25'),
          encuestaData: { objetivo: 'Fuerza' },
          fechaConversion: new Date('2026-04-02'),
        });

        expect(await repository.countConversions(gymId, MARZO)).toBe(1);
      });

      it('ignora a los convertidos sin fecha: no pertenecen a ningún período', async () => {
        await crearLead({
          createdAt: new Date('2026-03-05'),
          encuestaData: { objetivo: 'Fuerza' },
        });

        expect(await repository.countConversions(gymId, MARZO)).toBe(0);
      });

      it('no cuenta conversiones de otro gym', async () => {
        await crearLead({
          createdAt: new Date('2026-03-05'),
          gymId: otroGymId,
          encuestaData: { objetivo: 'Fuerza' },
          fechaConversion: new Date('2026-03-06'),
        });

        expect(await repository.countConversions(gymId, MARZO)).toBe(0);
      });
    });
  });
});

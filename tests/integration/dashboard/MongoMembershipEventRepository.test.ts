import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { MongoMembershipEventRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoMembershipEventRepository';
import { MembershipEventModel } from '../../../src/infrastructure/database/mongoose/schemas/MembershipEventSchema';
import { CreateMembershipEventInput } from '../../../src/domain/repositories/IMembershipEventRepository';

/**
 * Test de integración contra Mongo en memoria (ver tests/setup.ts).
 *
 * Lo que se verifica acá y un mock no puede: que la distinción entre "no hubo cobro" y
 * "cobró cero", y entre "no consta el vencimiento" y "no venció", sobreviva al viaje a
 * la base. El schema deja `monto` y `vencimientoNuevo` sin default a propósito, y si
 * el adaptador los materializara en 0 o en una fecha, los ingresos sumarían pagos
 * fantasma y las renovaciones históricas dibujarían ventanas inventadas.
 */
describe('MongoMembershipEventRepository (integración)', () => {
  const repository = new MongoMembershipEventRepository();

  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();
  const clientId = new Types.ObjectId().toString();
  const otroClientId = new Types.ObjectId().toString();

  const alta: CreateMembershipEventInput = {
    gymId,
    clientId,
    tipo: 'alta',
    fecha: new Date('2026-01-01'),
    vencimientoNuevo: new Date('2026-02-01'),
    origen: 'operacion',
  };

  describe('create', () => {
    it('persiste el evento y lo devuelve mapeado al dominio', async () => {
      const creado = await repository.create({
        ...alta,
        tipo: 'renovacion',
        monto: 25000,
        vencimientoAnterior: new Date('2026-02-01'),
        vencimientoNuevo: new Date('2026-03-01'),
      });

      expect(creado.id).toBeDefined();
      expect(creado.gymId).toBe(gymId);
      expect(creado.clientId).toBe(clientId);
      expect(creado.tipo).toBe('renovacion');
      expect(creado.monto).toBe(25000);
      expect(creado.vencimientoAnterior).toEqual(new Date('2026-02-01'));
      expect(creado.vencimientoNuevo).toEqual(new Date('2026-03-01'));
    });

    it('deja el monto ausente cuando la operación no tuvo cobro', async () => {
      const creado = await repository.create(alta);

      // Un 0 por omisión se sumaría a los ingresos como si fuera un pago real.
      const enBase = await MembershipEventModel.findById(creado.id);
      expect(enBase!.monto).toBeUndefined();
      expect(creado.monto).toBeUndefined();
    });

    it('distingue el cobro de cero de la ausencia de cobro', async () => {
      const creado = await repository.create({ ...alta, monto: 0 });

      const enBase = await MembershipEventModel.findById(creado.id);
      expect(enBase!.monto).toBe(0);
    });

    it('deja el vencimiento ausente cuando no consta', async () => {
      const creado = await repository.create({
        gymId,
        clientId,
        tipo: 'renovacion',
        fecha: new Date('2025-06-01'),
        monto: 18000,
        origen: 'historico',
      });

      // Es el estado legítimo de una renovación sembrada del historial viejo: sin
      // vencimiento no dibuja ventana, y por eso no inventa churn.
      const enBase = await MembershipEventModel.findById(creado.id);
      expect(enBase!.vencimientoNuevo).toBeUndefined();
    });

    it('guarda el origen por defecto como operación', async () => {
      const creado = await repository.create({
        gymId,
        clientId,
        tipo: 'alta',
        fecha: new Date('2026-01-01'),
      } as CreateMembershipEventInput);

      const enBase = await MembershipEventModel.findById(creado.id);
      expect(enBase!.origen).toBe('operacion');
    });

    it('rechaza un tipo de evento fuera del enum', async () => {
      await expect(
        repository.create({ ...alta, tipo: 'baja' as never })
      ).rejects.toThrow();
    });
  });

  describe('createMany', () => {
    it('inserta el lote y devuelve cuántos entraron', async () => {
      const insertados = await repository.createMany([
        alta,
        { ...alta, tipo: 'renovacion', fecha: new Date('2026-02-01'), monto: 25000 },
        { ...alta, clientId: otroClientId },
      ]);

      expect(insertados).toBe(3);
      expect(await MembershipEventModel.countDocuments({ gymId })).toBe(3);
    });

    it('no toca la base con un lote vacío', async () => {
      expect(await repository.createMany([])).toBe(0);
      expect(await MembershipEventModel.countDocuments({})).toBe(0);
    });
  });

  describe('findByClientId', () => {
    it('devuelve el historial del socio en orden cronológico', async () => {
      await repository.createMany([
        { ...alta, tipo: 'renovacion', fecha: new Date('2026-03-01'), monto: 30000 },
        alta,
        { ...alta, tipo: 'renovacion', fecha: new Date('2026-02-01'), monto: 25000 },
      ]);

      const historial = await repository.findByClientId(clientId, gymId);

      expect(historial.map((e) => e.fecha)).toEqual([
        new Date('2026-01-01'),
        new Date('2026-02-01'),
        new Date('2026-03-01'),
      ]);
    });

    it('no devuelve el historial de otro socio ni el de otro gym', async () => {
      await repository.createMany([
        alta,
        { ...alta, clientId: otroClientId },
        { ...alta, gymId: otroGymId },
      ]);

      expect(await repository.findByClientId(clientId, gymId)).toHaveLength(1);
      expect(await repository.findByClientId(clientId, otroGymId)).toHaveLength(1);
      expect(await repository.findByClientId(otroClientId, otroGymId)).toHaveLength(0);
    });
  });

  describe('countByGym', () => {
    it('cuenta solo los eventos del gym', async () => {
      await repository.createMany([
        alta,
        { ...alta, clientId: otroClientId },
        { ...alta, gymId: otroGymId },
      ]);

      expect(await repository.countByGym(gymId)).toBe(2);
      expect(await repository.countByGym(otroGymId)).toBe(1);
    });

    it('devuelve cero para un gym sin eventos: es lo que habilita la siembra', async () => {
      expect(await repository.countByGym(gymId)).toBe(0);
    });
  });
});

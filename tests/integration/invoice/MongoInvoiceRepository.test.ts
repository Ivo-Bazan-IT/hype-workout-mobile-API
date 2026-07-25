import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { MongoInvoiceRepository } from '../../../src/infrastructure/database/mongoose/repositories/MongoInvoiceRepository';

const repo = new MongoInvoiceRepository();

const gymId = new Types.ObjectId().toString();
const otroGymId = new Types.ObjectId().toString();
const clientId = new Types.ObjectId().toString();
const otroClientId = new Types.ObjectId().toString();

const emitir = (overrides: Record<string, any> = {}) =>
  repo.create({
    gymId,
    clientId,
    tipoComprobante: 'Factura C',
    cae: '75123456789012',
    monto: 15000,
    estado: 'emitida',
    ...overrides,
  });

describe('MongoInvoiceRepository', () => {
  it('persiste una factura de error sin CAE (registro del fallo de AFIP)', async () => {
    // El schema tenía `cae` como required y Mongoose rechaza la cadena vacía:
    // el registro del error explotaba y se llevaba puesta la renovación del socio.
    const invoice = await emitir({ cae: '', estado: 'error', errorLog: 'AFIP caído' });

    expect(invoice.id).toBeDefined();
    expect(invoice.estado).toBe('error');
    expect(invoice.cae).toBe('');
  });

  it('aísla por gym: no devuelve la factura de otro tenant', async () => {
    const invoice = await emitir();

    expect(await repo.findById(invoice.id, gymId)).not.toBeNull();
    // Mismo id, otro gym => no existe
    expect(await repo.findById(invoice.id, otroGymId)).toBeNull();
  });

  it('el listado nunca mezcla facturas de otro gym', async () => {
    await emitir();
    await repo.create({
      gymId: otroGymId,
      clientId: otroClientId,
      tipoComprobante: 'Factura B',
      cae: '99999999999999',
      monto: 99999,
      estado: 'emitida',
    });

    const result = await repo.search(gymId, {});

    expect(result.total).toBe(1);
    expect(result.data[0].gymId).toBe(gymId);
    expect(result.data[0].monto).toBe(15000);
  });

  it('filtra por socio, estado y CAE', async () => {
    await emitir();
    await emitir({ clientId: otroClientId, cae: '11111111111111', monto: 8000 });
    await emitir({ estado: 'error', cae: '', monto: 5000 });

    const porSocio = await repo.search(gymId, { clientId: otroClientId });
    expect(porSocio.total).toBe(1);
    expect(porSocio.data[0].monto).toBe(8000);

    const porEstado = await repo.search(gymId, { estado: 'error' });
    expect(porEstado.total).toBe(1);

    const porCae = await repo.search(gymId, { cae: '75123456789012' });
    expect(porCae.total).toBe(1);
    expect(porCae.data[0].cae).toBe('75123456789012');
  });

  it('filtra por rango de fechas de emisión', async () => {
    await emitir({ fechaEmision: new Date('2026-01-15'), monto: 1000 });
    await emitir({ fechaEmision: new Date('2026-03-15'), monto: 2000 });
    await emitir({ fechaEmision: new Date('2026-06-15'), monto: 3000 });

    const result = await repo.search(gymId, {
      emitidaDesde: new Date('2026-02-01'),
      emitidaHasta: new Date('2026-04-30'),
    });

    expect(result.total).toBe(1);
    expect(result.data[0].monto).toBe(2000);
  });

  it('pagina y ordena por fecha de emisión descendente', async () => {
    await emitir({ fechaEmision: new Date('2026-01-10'), monto: 1000 });
    await emitir({ fechaEmision: new Date('2026-02-10'), monto: 2000 });
    await emitir({ fechaEmision: new Date('2026-03-10'), monto: 3000 });

    const primera = await repo.search(gymId, {}, 1, 2);

    expect(primera.total).toBe(3);
    expect(primera.totalPages).toBe(2);
    // Más reciente primero
    expect(primera.data.map((i) => i.monto)).toEqual([3000, 2000]);

    const segunda = await repo.search(gymId, {}, 2, 2);
    expect(segunda.data.map((i) => i.monto)).toEqual([1000]);
  });

  it('el reporte de ingresos suma solo facturas emitidas y desglosa por mes', async () => {
    await emitir({ fechaEmision: new Date('2026-01-10'), monto: 1000 });
    await emitir({ fechaEmision: new Date('2026-01-20'), monto: 500 });
    await emitir({ fechaEmision: new Date('2026-02-10'), monto: 2000 });
    // Una factura fallida no es plata cobrada: no debe sumar
    await emitir({ fechaEmision: new Date('2026-02-11'), monto: 9999, estado: 'error', cae: '' });

    const report = await repo.getRevenueByPeriod(
      gymId,
      new Date('2026-01-01'),
      new Date('2026-02-28')
    );

    expect(report.total).toBe(3500);
    expect(report.cantidad).toBe(3);
    expect(report.porMes).toEqual([
      { year: 2026, month: 1, total: 1500, cantidad: 2 },
      { year: 2026, month: 2, total: 2000, cantidad: 1 },
    ]);
  });

  it('el reporte de ingresos no incluye facturación de otro gym', async () => {
    await emitir({ fechaEmision: new Date('2026-01-10'), monto: 1000 });
    await repo.create({
      gymId: otroGymId,
      clientId: otroClientId,
      tipoComprobante: 'Factura B',
      cae: '99999999999999',
      monto: 500000,
      estado: 'emitida',
      fechaEmision: new Date('2026-01-10'),
    });

    const report = await repo.getRevenueByPeriod(
      gymId,
      new Date('2026-01-01'),
      new Date('2026-01-31')
    );

    expect(report.total).toBe(1000);
  });
});

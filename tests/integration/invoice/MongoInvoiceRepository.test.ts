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

  describe('cola de emisión', () => {
    const LEASE_MS = 60_000;

    const encolar = (overrides: Record<string, any> = {}) =>
      repo.create({
        gymId,
        clientId,
        tipoComprobante: 'Factura C',
        codigoTipoComprobante: 11,
        monto: 15000,
        descripcion: 'Cuota Mensual - marzo',
        estado: 'pendiente',
        ...overrides,
      });

    const resultado = {
      cae: '75123456789012',
      vencimientoCae: new Date('2026-04-10'),
      numeroComprobante: 42,
      puntoVenta: 3,
      codigoTipoComprobante: 11,
      tipoComprobante: 'Factura C',
      neto: 15000,
      iva: 0,
      importeTotal: 15000,
    };

    it('una factura nace lista para emitir y con cero intentos', async () => {
      const invoice = await encolar();

      expect(invoice.estado).toBe('pendiente');
      expect(invoice.intentos).toBe(0);
      expect(invoice.proximoIntento).toBeDefined();
    });

    it('toma la pendiente e incrementa su contador de intentos', async () => {
      await encolar();

      const tomada = await repo.claimPendiente(LEASE_MS);

      expect(tomada?.intentos).toBe(1);
      expect(tomada?.gymId).toBe(gymId);
    });

    it('dos claims concurrentes NO se llevan la misma factura', async () => {
      // El invariante que sostiene todo: si los dos la tomaran, el socio recibiría
      // dos comprobantes por la misma cuota y habría que anular uno con nota de
      // crédito.
      await encolar();

      const [primera, segunda] = await Promise.all([
        repo.claimPendiente(LEASE_MS),
        repo.claimPendiente(LEASE_MS),
      ]);

      const tomadas = [primera, segunda].filter(Boolean);
      expect(tomadas).toHaveLength(1);
    });

    it('no vuelve a entregar una factura reservada hasta que vence el lease', async () => {
      await encolar();

      await repo.claimPendiente(LEASE_MS);

      expect(await repo.claimPendiente(LEASE_MS)).toBeNull();
    });

    it('recupera la factura de un proceso que murió, cuando el lease venció', async () => {
      await encolar({ proximoIntento: new Date(Date.now() - 1000) });

      expect(await repo.claimPendiente(LEASE_MS)).not.toBeNull();
    });

    it('no toma las que todavía están esperando su backoff', async () => {
      await encolar({ proximoIntento: new Date(Date.now() + 60_000) });

      expect(await repo.claimPendiente(LEASE_MS)).toBeNull();
    });

    it('ignora las que ya están emitidas o en error', async () => {
      await emitir();
      await emitir({ cae: '', estado: 'error', errorLog: 'CUIT inválido' });

      expect(await repo.claimPendiente(LEASE_MS)).toBeNull();
    });

    it('marcarEmitida guarda la terna del comprobante y lo saca de la cola', async () => {
      const invoice = await encolar();

      const emitida = await repo.marcarEmitida(
        invoice.id,
        gymId,
        resultado,
        new Date('2026-03-11T10:00:00.000Z')
      );

      expect(emitida).toMatchObject({
        estado: 'emitida',
        cae: '75123456789012',
        numeroComprobante: 42,
        puntoVenta: 3,
        codigoTipoComprobante: 11,
        neto: 15000,
        iva: 0,
      });
      expect(emitida?.vencimientoCae).toEqual(new Date('2026-04-10'));
      // Fuera de la cola: sin `proximoIntento` ningún claim la vuelve a tomar.
      expect(emitida?.proximoIntento).toBeUndefined();
    });

    it('marcarEmitida limpia el error de los intentos previos', async () => {
      const invoice = await encolar({ errorLog: 'AFIP caído', estado: 'pendiente' });

      const emitida = await repo.marcarEmitida(invoice.id, gymId, resultado, new Date());

      expect(emitida?.errorLog).toBeUndefined();
    });

    it('marcarEmitida no puede cerrar la factura de otro gym', async () => {
      const invoice = await encolar();

      expect(await repo.marcarEmitida(invoice.id, otroGymId, resultado, new Date())).toBeNull();
    });

    it('un fallo transitorio deja la factura de nuevo tomable en su próximo intento', async () => {
      const invoice = await encolar();
      await repo.claimPendiente(LEASE_MS);

      await repo.marcarFallo(invoice.id, gymId, {
        estado: 'pendiente',
        errorLog: 'AFIP caído',
        proximoIntento: new Date(Date.now() - 1000),
      });

      const reintentada = await repo.claimPendiente(LEASE_MS);
      expect(reintentada?.id).toBe(invoice.id);
      expect(reintentada?.intentos).toBe(2);
    });

    it('un fallo definitivo la saca de la cola', async () => {
      const invoice = await encolar();

      await repo.marcarFallo(invoice.id, gymId, {
        estado: 'error',
        errorLog: 'CUIT inválido',
      });

      const enError = await repo.findById(invoice.id, gymId);
      expect(enError?.estado).toBe('error');
      expect(enError?.proximoIntento).toBeUndefined();
      expect(await repo.claimPendiente(LEASE_MS)).toBeNull();
    });

    it('el reintento manual la devuelve a la cola', async () => {
      const invoice = await encolar();
      await repo.marcarFallo(invoice.id, gymId, { estado: 'error', errorLog: 'CUIT inválido' });

      await repo.update(invoice.id, gymId, {
        estado: 'pendiente',
        intentos: 0,
        proximoIntento: new Date(),
      });

      const tomada = await repo.claimPendiente(LEASE_MS);
      expect(tomada?.id).toBe(invoice.id);
      expect(tomada?.intentos).toBe(1);
    });
  });
});

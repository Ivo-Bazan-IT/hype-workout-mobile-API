import { describe, it, expect, vi, afterEach } from 'vitest';
import { EmitPendingInvoicesUseCase } from '../../../src/application/use-cases/invoice/EmitPendingInvoicesUseCase';
import { ClientTaxCondition, GymTaxCondition } from '../../../src/domain/billing/types';
import { InvoiceEmissionError } from '../../../src/domain/billing/errors';
import { env } from '../../../src/config/env';

const facturaPendiente = (extra: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  gymId: 'gym-1',
  clientId: 'client-1',
  tipoComprobante: 'Factura C',
  codigoTipoComprobante: 11,
  cae: '',
  monto: 15000,
  descripcion: 'Cuota Mensual - marzo',
  fechaEmision: new Date(),
  estado: 'pendiente' as const,
  // El repositorio incrementa el contador al TOMAR la factura, así que el caso de
  // uso siempre la recibe con al menos un intento consumido.
  intentos: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

const resultadoAfip = {
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

const credencialesPropias = { accessToken: 'access-token', cert: 'cert-pem', key: 'key-pem' };

/**
 * Por defecto todo está bien configurado y AFIP contesta, en modo `cuenta_propia`
 * (el default de `AFIP_BILLING_MODE`). Cada test rompe solo la pieza que le interesa.
 */
function build(overrides: Record<string, any> = {}) {
  const emitInvoice = overrides.emitInvoice ?? vi.fn().mockResolvedValue(resultadoAfip);

  // `claimPendiente` devuelve una factura y después null, para que el lote corte.
  const claimPendiente =
    overrides.claimPendiente ??
    vi.fn().mockResolvedValueOnce(overrides.factura ?? facturaPendiente()).mockResolvedValue(null);

  const invoiceRepository = {
    claimPendiente,
    marcarEmitida: vi.fn().mockResolvedValue({}),
    marcarFallo: vi.fn().mockResolvedValue({}),
  } as any;

  const gymRepository = {
    findById: vi.fn().mockResolvedValue(
      overrides.gym ?? {
        id: 'gym-1',
        cuit: '20-12345678-9',
        afipConfig: {
          isActive: true,
          puntoVenta: 3,
          taxCondition: GymTaxCondition.MONOTRIBUTO,
        },
      }
    ),
  } as any;

  const gymSecretsRepo = {
    getAfipApiKey: vi
      .fn()
      .mockResolvedValue('apiKey' in overrides ? overrides.apiKey : 'afip-key'),
    // Sin `??`: el caso interesante es justamente `credenciales: null`, que `??`
    // reemplazaría.
    getAfipCredentials: vi
      .fn()
      .mockResolvedValue('credenciales' in overrides ? overrides.credenciales : credencialesPropias),
  } as any;

  const clientRepository = {
    findById: vi
      .fn()
      .mockResolvedValue(
        overrides.cliente === undefined
          ? { id: 'client-1', gymId: 'gym-1', documento: '12.345.678' }
          : overrides.cliente
      ),
  } as any;

  const ownAccountProviderFactory = { create: vi.fn().mockReturnValue({ emitInvoice }) } as any;
  const legacyProviderFactory = { create: vi.fn().mockReturnValue({ emitInvoice }) } as any;

  const useCase = new EmitPendingInvoicesUseCase(
    invoiceRepository,
    gymRepository,
    gymSecretsRepo,
    clientRepository,
    ownAccountProviderFactory,
    legacyProviderFactory
  );

  return {
    useCase,
    invoiceRepository,
    gymRepository,
    gymSecretsRepo,
    ownAccountProviderFactory,
    legacyProviderFactory,
    emitInvoice,
  };
}

describe('EmitPendingInvoicesUseCase (modo cuenta_propia, default)', () => {
  it('emite la factura pendiente y la marca como emitida', async () => {
    const { useCase, invoiceRepository, emitInvoice } = build();

    const resumen = await useCase.execute();

    expect(emitInvoice).toHaveBeenCalledWith({
      amount: 15000,
      description: 'Cuota Mensual - marzo',
      clientTaxCondition: ClientTaxCondition.CONSUMIDOR_FINAL,
      clientDocument: 12345678,
      clientCuit: undefined,
    });
    expect(invoiceRepository.marcarEmitida).toHaveBeenCalledWith(
      'inv-1',
      'gym-1',
      resultadoAfip,
      expect.any(Date)
    );
    expect(resumen).toEqual({ procesadas: 1, emitidas: 1, fallidas: 0, truncado: false });
  });

  it('no hace nada si no hay facturas pendientes', async () => {
    const { useCase, invoiceRepository } = build({
      claimPendiente: vi.fn().mockResolvedValue(null),
    });

    const resumen = await useCase.execute();

    expect(resumen).toEqual({ procesadas: 0, emitidas: 0, fallidas: 0, truncado: false });
    expect(invoiceRepository.marcarEmitida).not.toHaveBeenCalled();
  });

  it('le pasa al proveedor el CUIT del gym normalizado, sin guiones, y sus credenciales', async () => {
    const { useCase, ownAccountProviderFactory } = build();

    await useCase.execute();

    // `parseInt('20-12345678-9')` daba 20: un CUIT truncado que AFIP habría
    // rechazado, o peor, atribuido a otro contribuyente.
    expect(ownAccountProviderFactory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cuit: 20123456789,
        puntoVenta: 3,
        accessToken: credencialesPropias.accessToken,
        cert: credencialesPropias.cert,
        key: credencialesPropias.key,
      })
    );
  });

  it('un cliente Responsable Inscripto factura a su CUIT, no a su DNI', async () => {
    const { useCase, emitInvoice } = build({
      gym: {
        id: 'gym-1',
        cuit: '20123456789',
        afipConfig: { isActive: true, puntoVenta: 3, taxCondition: GymTaxCondition.RESPONSABLE_INSCRIPTO },
      },
      cliente: {
        id: 'client-1',
        gymId: 'gym-1',
        documento: '12345678',
        condicionFiscal: ClientTaxCondition.RESPONSABLE_INSCRIPTO,
        cuit: '30-71112223-8',
      },
    });

    await useCase.execute();

    expect(emitInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTaxCondition: ClientTaxCondition.RESPONSABLE_INSCRIPTO,
        clientCuit: 30711122238,
        clientDocument: undefined,
      })
    );
  });

  it('marca error si el socio es Responsable Inscripto pero su CUIT no es válido', async () => {
    const { useCase, invoiceRepository } = build({
      cliente: {
        id: 'client-1',
        gymId: 'gym-1',
        documento: '12345678',
        condicionFiscal: ClientTaxCondition.RESPONSABLE_INSCRIPTO,
        cuit: '123',
      },
    });

    await useCase.execute();

    const [, , fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(fallo.estado).toBe('error');
    expect(fallo.errorLog).toMatch(/Responsable Inscripto/);
  });

  it('un fallo transitorio devuelve la factura a la cola con backoff', async () => {
    const { useCase, invoiceRepository } = build({
      emitInvoice: vi.fn().mockRejectedValue(new InvoiceEmissionError('AFIP caído', 'servicio')),
    });

    const resumen = await useCase.execute();

    expect(resumen.fallidas).toBe(1);
    const [id, gymId, fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(id).toBe('inv-1');
    expect(gymId).toBe('gym-1');
    expect(fallo.estado).toBe('pendiente');
    expect(fallo.proximoIntento.getTime()).toBeGreaterThan(Date.now());
  });

  it('un fallo de validación es definitivo y no se reintenta solo', async () => {
    const { useCase, invoiceRepository } = build({
      emitInvoice: vi
        .fn()
        .mockRejectedValue(new InvoiceEmissionError('DNI inválido', 'validacion')),
    });

    await useCase.execute();

    const [, , fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(fallo.estado).toBe('error');
    expect(fallo.proximoIntento).toBeUndefined();
  });

  it('agotados los intentos, hasta un fallo transitorio queda en error', async () => {
    const { useCase, invoiceRepository } = build({
      factura: facturaPendiente({ intentos: 5 }),
      emitInvoice: vi.fn().mockRejectedValue(new InvoiceEmissionError('timeout', 'red')),
    });

    await useCase.execute();

    const [, , fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(fallo.estado).toBe('error');
  });

  it('marca error si el gym apagó la facturación después de encolar', async () => {
    const { useCase, invoiceRepository, emitInvoice } = build({
      gym: { id: 'gym-1', cuit: '20123456789', afipConfig: { isActive: false } },
    });

    await useCase.execute();

    expect(emitInvoice).not.toHaveBeenCalled();
    const [, , fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(fallo.estado).toBe('error');
    expect(fallo.errorLog).toMatch(/no está activa/);
  });

  it('marca error si el CUIT del gym está mal cargado', async () => {
    const { useCase, invoiceRepository } = build({
      gym: {
        id: 'gym-1',
        cuit: '2012345',
        afipConfig: {
          isActive: true,
          puntoVenta: 1,
          taxCondition: GymTaxCondition.MONOTRIBUTO,
        },
      },
    });

    await useCase.execute();

    const [, , fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(fallo.estado).toBe('error');
    expect(fallo.errorLog).toMatch(/11 dígitos/);
  });

  it('marca error si el gimnasio no cargó su certificado, clave o API key de AFIP SDK', async () => {
    const { useCase, invoiceRepository } = build({ credenciales: null });

    await useCase.execute();

    const [, , fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(fallo.estado).toBe('error');
    expect(fallo.errorLog).toMatch(/certificado/);
  });

  it('marca error si el socio de la factura ya no existe', async () => {
    const { useCase, invoiceRepository } = build({ cliente: null });

    await useCase.execute();

    const [, , fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(fallo.estado).toBe('error');
    expect(fallo.errorLog).toMatch(/socio/);
  });

  it('un error inesperado se trata como transitorio, para no descartar el comprobante', async () => {
    const { useCase, invoiceRepository } = build({
      emitInvoice: vi.fn().mockRejectedValue(new TypeError('undefined is not a function')),
    });

    await useCase.execute();

    const [, , fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(fallo.estado).toBe('pendiente');
  });

  it('procesa varias facturas en un mismo tick', async () => {
    const { useCase, invoiceRepository } = build({
      claimPendiente: vi
        .fn()
        .mockResolvedValueOnce(facturaPendiente({ id: 'inv-1' }))
        .mockResolvedValueOnce(facturaPendiente({ id: 'inv-2' }))
        .mockResolvedValue(null),
    });

    const resumen = await useCase.execute();

    expect(resumen).toEqual({ procesadas: 2, emitidas: 2, fallidas: 0, truncado: false });
    expect(invoiceRepository.marcarEmitida).toHaveBeenCalledTimes(2);
  });

  /*
   * El tope y el presupuesto existen por el disparador HTTP: el cron corre cada
   * varios minutos, así que necesita drenar más facturas por corrida que el tick
   * interno de 15s, pero sin dejar el request colgado hasta que el cron corte.
   */
  describe('tope y presupuesto de tiempo', () => {
    it('respeta el maxFacturas recibido en vez del tope por defecto', async () => {
      const { useCase, invoiceRepository } = build({
        // Trabajo infinito: lo único que puede frenar el lote es el tope.
        claimPendiente: vi.fn().mockImplementation(() =>
          Promise.resolve(facturaPendiente({ id: `inv-${Math.random()}` }))
        ),
      });

      const resumen = await useCase.execute({ maxFacturas: 12 });

      expect(resumen.procesadas).toBe(12);
      expect(invoiceRepository.marcarEmitida).toHaveBeenCalledTimes(12);
    });

    it('marca truncado cuando corta por tope habiendo más cola', async () => {
      const { useCase } = build({
        claimPendiente: vi.fn().mockImplementation(() =>
          Promise.resolve(facturaPendiente({ id: `inv-${Math.random()}` }))
        ),
      });

      const resumen = await useCase.execute({ maxFacturas: 3 });

      expect(resumen).toEqual({ procesadas: 3, emitidas: 3, fallidas: 0, truncado: true });
    });

    it('no marca truncado cuando la cola se vació antes del tope', async () => {
      const { useCase } = build({
        claimPendiente: vi
          .fn()
          .mockResolvedValueOnce(facturaPendiente({ id: 'inv-1' }))
          .mockResolvedValue(null),
      });

      const resumen = await useCase.execute({ maxFacturas: 50 });

      expect(resumen.procesadas).toBe(1);
      expect(resumen.truncado).toBe(false);
    });

    it('corta por presupuesto de tiempo aunque quede cupo', async () => {
      const { useCase, invoiceRepository } = build({
        claimPendiente: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return facturaPendiente({ id: `inv-${Math.random()}` });
        }),
      });

      const resumen = await useCase.execute({ maxFacturas: 1000, presupuestoMs: 60 });

      expect(resumen.truncado).toBe(true);
      // Cortó muy por debajo del cupo: fue el reloj, no el tope.
      expect(resumen.procesadas).toBeLessThan(20);
      expect(invoiceRepository.marcarEmitida).toHaveBeenCalledTimes(resumen.procesadas);
    });

    it('no reclama una factura que no va a alcanzar a emitir', async () => {
      const claimPendiente = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return facturaPendiente({ id: `inv-${Math.random()}` });
      });
      const { useCase } = build({ claimPendiente });

      // Presupuesto ya agotado: reclamar dejaría la factura reservada 5 minutos
      // por el lease sin que nadie haya intentado emitirla.
      const resumen = await useCase.execute({ maxFacturas: 10, presupuestoMs: 0 });

      expect(claimPendiente).not.toHaveBeenCalled();
      expect(resumen).toEqual({ procesadas: 0, emitidas: 0, fallidas: 0, truncado: true });
    });
  });
});

describe('EmitPendingInvoicesUseCase (modo cuenta_unica, desconectado)', () => {
  const modoOriginal = env.AFIP_BILLING_MODE;

  afterEach(() => {
    (env as any).AFIP_BILLING_MODE = modoOriginal;
  });

  it('sigue andando tal cual estaba: usa la credencial de plataforma, no la del gym', async () => {
    (env as any).AFIP_BILLING_MODE = 'cuenta_unica';

    const { useCase, legacyProviderFactory, ownAccountProviderFactory, emitInvoice } = build();

    await useCase.execute();

    expect(legacyProviderFactory.create).toHaveBeenCalledWith(
      expect.objectContaining({ cuit: 20123456789, puntoVenta: 3, afipSdkApiKey: 'afip-key' })
    );
    expect(ownAccountProviderFactory.create).not.toHaveBeenCalled();
    expect(emitInvoice).toHaveBeenCalled();
  });

  it('marca error si falta AFIP_SDK_API_KEY de plataforma', async () => {
    (env as any).AFIP_BILLING_MODE = 'cuenta_unica';

    const { useCase, invoiceRepository } = build({ apiKey: null });

    await useCase.execute();

    const [, , fallo] = invoiceRepository.marcarFallo.mock.calls[0];
    expect(fallo.estado).toBe('error');
    expect(fallo.errorLog).toMatch(/AFIP_SDK_API_KEY/);
  });
});

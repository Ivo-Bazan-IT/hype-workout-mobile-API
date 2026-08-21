import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AfipSdkOwnAccountAdapter } from '../../../src/infrastructure/external/billing/AfipSdkOwnAccountAdapter';
import { ClientTaxCondition, GymTaxCondition } from '../../../src/domain/billing/types';
import { InvoiceEmissionError } from '../../../src/domain/billing/errors';

/*
 * `vi.hoisted` porque `vi.mock` se iza por encima de los imports: sin esto, la
 * fábrica del mock referenciaría `createNextVoucher` todavía sin inicializar.
 */
const { createNextVoucher, AfipMock } = vi.hoisted(() => {
  const createNextVoucher = vi.fn();
  const AfipMock = vi.fn().mockImplementation(() => ({
    ElectronicBilling: { createNextVoucher },
  }));
  return { createNextVoucher, AfipMock };
});

vi.mock('@afipsdk/afip.js', () => ({ default: AfipMock }));

const config = (taxCondition: GymTaxCondition) => ({
  tenantId: 'gym-1',
  cuit: 20123456789,
  puntoVenta: 4,
  taxCondition,
  accessToken: 'token-abc',
  cert: 'cert-pem',
  key: 'key-pem',
});

const payloadConsumidorFinal = {
  amount: 12100,
  clientDocument: 12345678,
  description: 'Cuota Mensual - marzo',
  clientTaxCondition: ClientTaxCondition.CONSUMIDOR_FINAL,
};

const resultadoAfip = () => ({ CAE: '75123456789012', CAEFchVto: '2026-04-10', voucherNumber: 42 });

beforeEach(() => {
  createNextVoucher.mockReset();
  createNextVoucher.mockResolvedValue(resultadoAfip());
  AfipMock.mockClear();
});

describe('AfipSdkOwnAccountAdapter', () => {
  it('instancia Afip con las credenciales propias del gym y el ambiente inyectado', () => {
    // eslint-disable-next-line no-new
    new AfipSdkOwnAccountAdapter(config(GymTaxCondition.MONOTRIBUTO), 'prod');

    expect(AfipMock).toHaveBeenCalledWith({
      CUIT: 20123456789,
      cert: 'cert-pem',
      key: 'key-pem',
      access_token: 'token-abc',
      production: true,
    });
  });

  it('monotributo: arma Factura C sin desglose de IVA, sin mirar al cliente', async () => {
    const adapter = new AfipSdkOwnAccountAdapter(config(GymTaxCondition.MONOTRIBUTO), 'dev');

    await adapter.emitInvoice(payloadConsumidorFinal);

    const data = createNextVoucher.mock.calls[0][0];
    expect(data).toMatchObject({
      Concepto: 2,
      DocTipo: 96,
      DocNro: 12345678,
      CbteTipo: 11,
      PtoVta: 4,
      ImpTotal: 12100,
      ImpNeto: 12100,
      ImpIVA: 0,
      CondicionIVAReceptorId: 5,
    });
    // La C no discrimina IVA: no se manda el array.
    expect(data.Iva).toBeUndefined();
  });

  it('responsable inscripto + cliente consumidor final: Factura B con IVA discriminado', async () => {
    const adapter = new AfipSdkOwnAccountAdapter(config(GymTaxCondition.RESPONSABLE_INSCRIPTO), 'dev');

    await adapter.emitInvoice(payloadConsumidorFinal);

    const data = createNextVoucher.mock.calls[0][0];
    expect(data).toMatchObject({ CbteTipo: 6, DocTipo: 96, DocNro: 12345678, CondicionIVAReceptorId: 5 });
    expect(data.Iva).toEqual([{ Id: 5, BaseImp: 10000, Importe: 2100 }]);
  });

  it('responsable inscripto + cliente responsable inscripto: Factura A a su propio CUIT', async () => {
    const adapter = new AfipSdkOwnAccountAdapter(config(GymTaxCondition.RESPONSABLE_INSCRIPTO), 'dev');

    await adapter.emitInvoice({
      amount: 12100,
      description: 'Cuota corporativa',
      clientTaxCondition: ClientTaxCondition.RESPONSABLE_INSCRIPTO,
      clientCuit: 30711122238,
    });

    const data = createNextVoucher.mock.calls[0][0];
    expect(data).toMatchObject({ CbteTipo: 1, DocTipo: 80, DocNro: 30711122238, CondicionIVAReceptorId: 1 });
    expect(data.Iva).toEqual([{ Id: 5, BaseImp: 10000, Importe: 2100 }]);
  });

  it('un cliente Responsable Inscripto sin CUIT cargado no llega a pedirle nada a AFIP', async () => {
    const adapter = new AfipSdkOwnAccountAdapter(config(GymTaxCondition.RESPONSABLE_INSCRIPTO), 'dev');

    const error = await adapter
      .emitInvoice({
        amount: 1000,
        description: 'x',
        clientTaxCondition: ClientTaxCondition.RESPONSABLE_INSCRIPTO,
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(InvoiceEmissionError);
    expect(error.tipo).toBe('validacion');
    expect(createNextVoucher).not.toHaveBeenCalled();
  });

  it('devuelve el número de comprobante y el vencimiento del CAE que asignó AFIP', async () => {
    const adapter = new AfipSdkOwnAccountAdapter(config(GymTaxCondition.MONOTRIBUTO), 'dev');

    const resultado = await adapter.emitInvoice(payloadConsumidorFinal);

    expect(resultado).toMatchObject({
      cae: '75123456789012',
      numeroComprobante: 42,
      puntoVenta: 4,
      codigoTipoComprobante: 11,
      tipoComprobante: 'Factura C',
    });
    expect(resultado.vencimientoCae.getFullYear()).toBe(2026);
    expect(resultado.vencimientoCae.getMonth()).toBe(3); // abril
    expect(resultado.vencimientoCae.getDate()).toBe(10);
  });

  describe('clasificación de errores', () => {
    it('un AfipWebServiceError (rechazo de AFIP) es de validación', async () => {
      // Así se ve un AfipWebServiceError real: tiene `code`, nunca `status`.
      const err: any = Object.assign(new Error('(10016) CUIT no autorizado'), { code: 10016 });
      createNextVoucher.mockRejectedValue(err);

      const adapter = new AfipSdkOwnAccountAdapter(config(GymTaxCondition.MONOTRIBUTO), 'dev');
      const error = await adapter.emitInvoice(payloadConsumidorFinal).catch((e) => e);

      expect(error).toBeInstanceOf(InvoiceEmissionError);
      expect(error.tipo).toBe('validacion');
      expect(error.esTransitorio).toBe(false);
    });

    it('un error HTTP 5xx contra el proxy de AFIP SDK es transitorio', async () => {
      const err: any = Object.assign(new Error('Service Unavailable'), { status: 503 });
      createNextVoucher.mockRejectedValue(err);

      const adapter = new AfipSdkOwnAccountAdapter(config(GymTaxCondition.MONOTRIBUTO), 'dev');
      const error = await adapter.emitInvoice(payloadConsumidorFinal).catch((e) => e);

      expect(error.tipo).toBe('servicio');
      expect(error.esTransitorio).toBe(true);
    });

    it('un error HTTP 401 (access token inválido) es de validación, no se reintenta solo', async () => {
      const err: any = Object.assign(new Error('Unauthorized'), { status: 401 });
      createNextVoucher.mockRejectedValue(err);

      const adapter = new AfipSdkOwnAccountAdapter(config(GymTaxCondition.MONOTRIBUTO), 'dev');
      const error = await adapter.emitInvoice(payloadConsumidorFinal).catch((e) => e);

      expect(error.tipo).toBe('validacion');
      expect(error.esTransitorio).toBe(false);
    });

    it('un timeout sin status ni code es de red', async () => {
      createNextVoucher.mockRejectedValue(new Error('ECONNABORTED'));

      const adapter = new AfipSdkOwnAccountAdapter(config(GymTaxCondition.MONOTRIBUTO), 'dev');
      const error = await adapter.emitInvoice(payloadConsumidorFinal).catch((e) => e);

      expect(error.tipo).toBe('red');
      expect(error.esTransitorio).toBe(true);
    });
  });
});

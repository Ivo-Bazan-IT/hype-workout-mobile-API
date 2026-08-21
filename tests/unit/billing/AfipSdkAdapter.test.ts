import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AfipSdkAdapter } from '../../../src/infrastructure/external/billing/AfipSdkAdapter';
import { ClientTaxCondition, GymTaxCondition } from '../../../src/domain/billing/types';
import { InvoiceEmissionError } from '../../../src/domain/billing/errors';

vi.mock('axios');

const post = vi.fn();

const respuestaAfip = {
  cae: '75123456789012',
  vencimiento_cae: '20260410',
  numero_comprobante: 42,
  punto_venta: 3,
  tipo_comprobante: 11,
};

const adaptador = (taxCondition: GymTaxCondition, environment: 'dev' | 'prod' = 'dev') =>
  new AfipSdkAdapter(
    {
      tenantId: 'gym-1',
      cuit: 20123456789,
      puntoVenta: 3,
      taxCondition,
      afipSdkApiKey: 'afip-key',
    },
    'https://api.afipsdk.test',
    environment
  );

// El adaptador legacy nunca lee `clientTaxCondition` (no soporta Factura A), pero
// el tipo compartido `GymInvoicePayload` lo exige: se manda Consumidor Final, que
// es el único caso que este adaptador conoce.
const payload = {
  amount: 12100,
  clientDocument: 12345678,
  description: 'Cuota Mensual - marzo',
  clientTaxCondition: ClientTaxCondition.CONSUMIDOR_FINAL,
};

/** El cuerpo con el que se llamó a la API. */
const requestEnviado = () => post.mock.calls[0][1];

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: respuestaAfip });
  vi.mocked(axios.create).mockReturnValue({ post } as any);
});

describe('AfipSdkAdapter', () => {
  describe('monotributo', () => {
    it('emite Factura C y no discrimina IVA', async () => {
      await adaptador(GymTaxCondition.MONOTRIBUTO).emitInvoice(payload);

      expect(requestEnviado()).toMatchObject({
        tipo_comprobante: 11,
        importe_total: 12100,
        importe_neto: 12100,
        importe_iva: 0,
      });
    });
  });

  describe('responsable inscripto', () => {
    it('emite Factura B con el IVA desagregado del precio', async () => {
      await adaptador(GymTaxCondition.RESPONSABLE_INSCRIPTO).emitInvoice(payload);

      expect(requestEnviado()).toMatchObject({
        tipo_comprobante: 6,
        importe_total: 12100,
        importe_neto: 10000,
        importe_iva: 2100,
      });
    });

    it('neto + IVA da exactamente el total cobrado', async () => {
      // AFIP rechaza el comprobante si la suma no cierra al centavo, así que este
      // invariante vale para cualquier importe, no solo para los redondos.
      await adaptador(GymTaxCondition.RESPONSABLE_INSCRIPTO).emitInvoice({
        ...payload,
        amount: 15333.33,
      });

      const { importe_neto, importe_iva, importe_total } = requestEnviado();
      expect(Number((importe_neto + importe_iva).toFixed(2))).toBe(importe_total);
    });
  });

  it('manda el CUIT del gimnasio emisor', async () => {
    await adaptador(GymTaxCondition.MONOTRIBUTO).emitInvoice(payload);

    expect(requestEnviado()).toMatchObject({ cuit: 20123456789, punto_venta: 3 });
  });

  /*
   * El adaptador ya no decide contra qué ARCA se emite: lo recibe inyectado y lo
   * reenvía tal cual. Antes lo derivaba de NODE_ENV por su cuenta, y una decisión
   * fiscal no puede depender de una variable que se toca por otros motivos.
   */
  it('reenvía el entorno que le inyectaron, sin interpretarlo', async () => {
    await adaptador(GymTaxCondition.MONOTRIBUTO, 'dev').emitInvoice(payload);
    expect(requestEnviado()).toMatchObject({ environment: 'dev' });

    post.mockClear();
    await adaptador(GymTaxCondition.MONOTRIBUTO, 'prod').emitInvoice(payload);
    expect(requestEnviado()).toMatchObject({ environment: 'prod' });
  });

  it('factura siempre a consumidor final, con DNI', async () => {
    await adaptador(GymTaxCondition.RESPONSABLE_INSCRIPTO).emitInvoice(payload);

    // 96 = DNI. Nunca 80 (CUIT), que es lo que llevaría a emitir una Factura A.
    expect(requestEnviado()).toMatchObject({ tipo_documento: 96, numero_documento: 12345678 });
  });

  it('devuelve la terna del comprobante y el vencimiento del CAE', async () => {
    const resultado = await adaptador(GymTaxCondition.MONOTRIBUTO).emitInvoice(payload);

    expect(resultado).toMatchObject({
      cae: '75123456789012',
      numeroComprobante: 42,
      puntoVenta: 3,
      codigoTipoComprobante: 11,
      tipoComprobante: 'Factura C',
    });
    expect(resultado.vencimientoCae.getFullYear()).toBe(2026);
    expect(resultado.vencimientoCae.getMonth()).toBe(3); // abril
    expect(resultado.vencimientoCae.getDate()).toBe(10);
  });

  describe('clasificación de errores', () => {
    it('un 4xx es de validación y no se reintenta', async () => {
      post.mockRejectedValue({ response: { status: 400, data: { error: 'DNI inválido' } } });

      const error = await adaptador(GymTaxCondition.MONOTRIBUTO)
        .emitInvoice(payload)
        .catch((e) => e);

      expect(error).toBeInstanceOf(InvoiceEmissionError);
      expect(error.tipo).toBe('validacion');
      expect(error.esTransitorio).toBe(false);
    });

    it('un 5xx es transitorio', async () => {
      post.mockRejectedValue({ response: { status: 503, data: {} } });

      const error = await adaptador(GymTaxCondition.MONOTRIBUTO)
        .emitInvoice(payload)
        .catch((e) => e);

      expect(error.tipo).toBe('servicio');
      expect(error.esTransitorio).toBe(true);
    });

    it('un timeout sin respuesta es transitorio', async () => {
      post.mockRejectedValue(new Error('ECONNABORTED'));

      const error = await adaptador(GymTaxCondition.MONOTRIBUTO)
        .emitInvoice(payload)
        .catch((e) => e);

      expect(error.tipo).toBe('red');
      expect(error.esTransitorio).toBe(true);
    });
  });
});

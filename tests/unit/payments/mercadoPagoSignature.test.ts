import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verificarFirmaMercadoPago } from '../../../src/infrastructure/external/payments/mercadoPagoSignature';

const SECRET = 'un-secreto-de-la-app-de-mercado-pago';

const firmarValido = (params: { dataId: string; xRequestId: string; ts: string }) => {
  const manifest = `id:${params.dataId};request-id:${params.xRequestId};ts:${params.ts};`;
  const v1 = createHmac('sha256', SECRET).update(manifest).digest('hex');
  return `ts=${params.ts},v1=${v1}`;
};

describe('verificarFirmaMercadoPago', () => {
  it('acepta una firma armada con el mismo secreto y manifest', () => {
    const xSignature = firmarValido({ dataId: '12345', xRequestId: 'req-1', ts: '1700000000' });

    const resultado = verificarFirmaMercadoPago({
      xSignature,
      xRequestId: 'req-1',
      dataId: '12345',
      secret: SECRET,
    });

    expect(resultado).toBe(true);
  });

  it('rechaza si el secreto no coincide', () => {
    const xSignature = firmarValido({ dataId: '12345', xRequestId: 'req-1', ts: '1700000000' });

    const resultado = verificarFirmaMercadoPago({
      xSignature,
      xRequestId: 'req-1',
      dataId: '12345',
      secret: 'otro-secreto',
    });

    expect(resultado).toBe(false);
  });

  it('rechaza si el dataId no coincide con el que se firmó', () => {
    const xSignature = firmarValido({ dataId: '12345', xRequestId: 'req-1', ts: '1700000000' });

    const resultado = verificarFirmaMercadoPago({
      xSignature,
      xRequestId: 'req-1',
      dataId: '99999',
      secret: SECRET,
    });

    expect(resultado).toBe(false);
  });

  it('rechaza si el x-request-id no coincide con el que se firmó', () => {
    const xSignature = firmarValido({ dataId: '12345', xRequestId: 'req-1', ts: '1700000000' });

    const resultado = verificarFirmaMercadoPago({
      xSignature,
      xRequestId: 'req-distinto',
      dataId: '12345',
      secret: SECRET,
    });

    expect(resultado).toBe(false);
  });

  it('rechaza un x-signature sin el formato ts=…,v1=…', () => {
    const resultado = verificarFirmaMercadoPago({
      xSignature: 'esto-no-tiene-la-forma-correcta',
      xRequestId: 'req-1',
      dataId: '12345',
      secret: SECRET,
    });

    expect(resultado).toBe(false);
  });
});

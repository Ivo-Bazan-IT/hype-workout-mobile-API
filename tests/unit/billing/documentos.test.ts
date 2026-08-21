import { describe, it, expect } from 'vitest';
import { normalizarCuit, normalizarDocumento } from '../../../src/domain/billing/documentos';

describe('normalizarCuit', () => {
  it('acepta el formato con guiones que se usa al cargarlo', () => {
    // El caso que rompía: `parseInt('20-12345678-9')` devuelve 20 sin quejarse.
    expect(normalizarCuit('20-12345678-9')).toBe(20123456789);
  });

  it('acepta puntos y espacios', () => {
    expect(normalizarCuit('20.12345678.9')).toBe(20123456789);
    expect(normalizarCuit(' 20 12345678 9 ')).toBe(20123456789);
  });

  it('devuelve null si no quedan 11 dígitos', () => {
    expect(normalizarCuit('2012345')).toBeNull();
    expect(normalizarCuit('201234567891234')).toBeNull();
    expect(normalizarCuit('')).toBeNull();
  });
});

describe('normalizarDocumento', () => {
  it('acepta DNI con puntos', () => {
    expect(normalizarDocumento('12.345.678')).toBe(12345678);
  });

  it('acepta documentos viejos de 7 dígitos', () => {
    expect(normalizarDocumento('1234567')).toBe(1234567);
  });

  it('rechaza lo que no puede ser un DNI', () => {
    expect(normalizarDocumento('123')).toBeNull();
    expect(normalizarDocumento('20123456789')).toBeNull();
    expect(normalizarDocumento('sin numero')).toBeNull();
  });
});

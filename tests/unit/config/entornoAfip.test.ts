import { describe, it, expect } from 'vitest';
import { envSchema } from '../../../src/config/env';

/**
 * Contra qué ARCA se factura.
 *
 * Es la única barrera entre una corrida cualquiera y un comprobante real, y un
 * comprobante emitido de más ante ARCA **no se borra**: se anula con nota de
 * crédito, que es un trámite fiscal, no un `delete`.
 *
 * Antes esto se derivaba de `NODE_ENV` dentro del adaptador. Ahora la decisión
 * es explícita en el entorno y el esquema la exige: si falta o está mal escrita,
 * el proceso no arranca en vez de elegir un default por su cuenta.
 */
describe('AFIP_SDK_ENVIRONMENT', () => {
  const base = {
    MONGO_URI: 'mongodb://127.0.0.1:27017/test',
    JWT_ACCESS_SECRET: 'x',
    JWT_REFRESH_SECRET: 'y',
  };

  const parsear = (afipEnv?: string) =>
    envSchema.safeParse(
      afipEnv === undefined ? base : { ...base, AFIP_SDK_ENVIRONMENT: afipEnv }
    );

  it('acepta dev (homologación)', () => {
    const r = parsear('dev');
    expect(r.success && r.data.AFIP_SDK_ENVIRONMENT).toBe('dev');
  });

  it('acepta prod (comprobantes reales)', () => {
    const r = parsear('prod');
    expect(r.success && r.data.AFIP_SDK_ENVIRONMENT).toBe('prod');
  });

  it('falla si no está definida, en vez de asumir un default', () => {
    expect(parsear().success).toBe(false);
  });

  it('falla con un valor vacío', () => {
    expect(parsear('').success).toBe(false);
  });

  /*
   * `production` no es un valor válido —el válido es `prod`— y no puede colar por
   * parecerse: un typo que degrade a producción emite facturas de verdad.
   */
  it('falla con un valor parecido pero inválido', () => {
    expect(parsear('production').success).toBe(false);
    expect(parsear('PROD').success).toBe(false);
  });

  it('el host de AFIP SDK sí tiene default, porque no es una decisión fiscal', () => {
    const r = parsear('dev');
    expect(r.success && r.data.AFIP_SDK_BASE_URL).toBe('https://api.afipsdk.com');
  });
});

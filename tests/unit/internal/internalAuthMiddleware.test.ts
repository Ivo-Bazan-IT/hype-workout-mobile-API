import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * El middleware lee `env` al atender cada request, pero `env` se congela al
 * importarse (zod parsea `process.env` una sola vez). Para probar el caso "no hay
 * secreto configurado" hay que mockear el módulo: tocar `process.env` después del
 * import no cambia nada.
 */
const SECRETO = 'un-secreto-interno-de-al-menos-32-chars';
const mockEnv = { INVOICE_CRON_SECRET: SECRETO as string | undefined };

vi.mock('../../../src/config/env', () => ({
  get env() {
    return mockEnv;
  },
}));

const { internalAuthMiddleware, INTERNAL_SECRET_HEADER } = await import(
  '../../../src/interfaces/http/middlewares/internalAuthMiddleware'
);

const construirRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const construirReq = (secreto?: string) => ({
  header: vi.fn().mockImplementation((nombre: string) =>
    nombre === INTERNAL_SECRET_HEADER ? secreto : undefined
  ),
});

describe('internalAuthMiddleware', () => {
  beforeEach(() => {
    mockEnv.INVOICE_CRON_SECRET = SECRETO;
  });

  it('deja pasar cuando el secreto coincide', () => {
    const req = construirReq(SECRETO) as any;
    const res = construirRes();
    const next = vi.fn();

    internalAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rechaza con 401 si el secreto no coincide', () => {
    const req = construirReq('secreto-equivocado-pero-igual-de-largo') as any;
    const res = construirRes();
    const next = vi.fn();

    internalAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rechaza con 401 si el header no viene', () => {
    const req = construirReq(undefined) as any;
    const res = construirRes();
    const next = vi.fn();

    internalAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  /*
   * `timingSafeEqual` lanza si los buffers miden distinto. Sin el hash previo,
   * un secreto de otro largo haría reventar el middleware con un 500 en vez de
   * responder 401 — y ese 500 delataría el largo del secreto real.
   */
  it('responde 401, no 500, ante un secreto de otra longitud', () => {
    const req = construirReq('corto') as any;
    const res = construirRes();
    const next = vi.fn();

    expect(() => internalAuthMiddleware(req, res, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  /*
   * Sin secreto configurado se cierra, no se abre: un gatillo de emisión de
   * comprobantes ante AFIP accesible sin credencial es peor que uno caído.
   */
  it('responde 503 si no hay secreto configurado, aunque manden uno', () => {
    mockEnv.INVOICE_CRON_SECRET = undefined;

    const req = construirReq(SECRETO) as any;
    const res = construirRes();
    const next = vi.fn();

    internalAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('no acepta un prefijo del secreto correcto', () => {
    const req = construirReq(SECRETO.slice(0, -1)) as any;
    const res = construirRes();
    const next = vi.fn();

    internalAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

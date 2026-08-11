import { describe, it, expect, vi } from 'vitest';
import { GetGymKpisSeriesUseCase } from '../../../src/application/use-cases/dashboard/GetGymKpisSeriesUseCase';

const f = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const AHORA = new Date('2026-03-15T12:00:00.000Z');

/**
 * Tres socios repartidos en meses distintos, para que la serie tenga relieve y no
 * sea la misma cuenta doce veces.
 *
 * - `enero`: alta en enero, se dio de baja en febrero (venció el 5, firme el 10).
 * - `febrero`: alta en febrero y sigue vigente.
 * - `marzo`: alta este mes.
 */
const historiales = [
  {
    clientId: 'enero',
    fechaAlta: f('2026-01-10'),
    windows: [{ inicio: f('2026-01-10'), vencimiento: f('2026-02-05'), monto: 1_000_000 }],
    pagos: [{ fecha: f('2026-01-10'), monto: 1_000_000 }],
  },
  {
    clientId: 'febrero',
    fechaAlta: f('2026-02-14'),
    windows: [
      { inicio: f('2026-02-14'), vencimiento: f('2026-03-16'), monto: 800_000 },
      { inicio: f('2026-03-14'), vencimiento: f('2026-04-13'), monto: 900_000 },
    ],
    pagos: [
      { fecha: f('2026-02-14'), monto: 800_000 },
      { fecha: f('2026-03-14'), monto: 900_000 },
    ],
  },
  {
    clientId: 'marzo',
    fechaAlta: f('2026-03-02'),
    windows: [{ inicio: f('2026-03-02'), vencimiento: f('2026-04-01'), monto: 500_000 }],
    pagos: [{ fecha: f('2026-03-02'), monto: 500_000 }],
  },
];

function makeUseCase(overrides: Record<string, unknown> = {}) {
  const metricsRepository = {
    getMembershipHistories: vi.fn().mockResolvedValue(historiales),
    getDataCutoff: vi.fn().mockResolvedValue(f('2026-01-01')),
    countCheckIns: vi.fn().mockResolvedValue(0),
    getLastCheckInByClient: vi.fn().mockResolvedValue([]),
    getFirstCheckInDate: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as any;

  return { useCase: new GetGymKpisSeriesUseCase(metricsRepository), metricsRepository };
}

/** El punto de un mes `yyyy-MM` dentro de la serie. */
// Genérico y no `{ desde: Date }` a secas: si el parámetro fija la forma, el punto
// devuelto pierde el resto de sus campos y todas las aserciones sobre `ingresos`,
// `bajas` o `mrr` dejan de compilar.
const punto = <T extends { desde: Date }>(serie: { puntos: T[] }, mes: string): T =>
  serie.puntos.find((p) => p.desde.toISOString().startsWith(mes))!;

describe('GetGymKpisSeriesUseCase', () => {
  it('devuelve exactamente los meses pedidos', async () => {
    const { useCase } = makeUseCase();

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

    expect(serie.puntos).toHaveLength(12);
  });

  it('ordena los meses del más viejo al más nuevo y cierra en el mes en curso', async () => {
    const { useCase } = makeUseCase();

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

    expect(serie.puntos[0].desde.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(serie.puntos[11].desde.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('corta los meses a medianoche UTC, con rango semiabierto', async () => {
    const { useCase } = makeUseCase();

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 3 });

    // El fin de un mes es exactamente el inicio del siguiente.
    expect(serie.puntos[0].hasta.getTime()).toBe(serie.puntos[1].desde.getTime());
    expect(serie.puntos[2].desde.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(serie.puntos[2].hasta.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  /**
   * Es la razón de existir del endpoint: reemplazar doce llamadas por una.
   *
   * Si alguna vez el cálculo vuelve al repositorio dentro del bucle, la serie deja de
   * tener sentido —serían las mismas doce agregaciones, escondidas detrás de un solo
   * request— y este test es el que lo va a delatar.
   */
  it('lee el historial UNA sola vez, sin importar cuántos meses se pidan', async () => {
    const { useCase, metricsRepository } = makeUseCase();

    await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 24 });

    expect(metricsRepository.getMembershipHistories).toHaveBeenCalledTimes(1);
    expect(metricsRepository.getDataCutoff).toHaveBeenCalledTimes(1);
  });

  it('devuelve los meses vacíos igual, con ceros reales', async () => {
    const { useCase } = makeUseCase();

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

    // En julio de 2025 no pasó nada, pero el punto va: un mes ausente y un mes en
    // cero se dibujan distinto.
    const julio = punto(serie, '2025-07');

    expect(julio).toBeDefined();
    expect(julio.ingresos).toBe(0);
    expect(julio.altas).toBe(0);

    // Y en el mismo punto conviven las dos cosas: julio es anterior al corte
    // (2026-01-01), así que sus bajas no son 0 sino `null`. "No se fue nadie" y "no
    // se puede saber" son estados distintos y se dibujan distinto.
    expect(julio.bajas).toBeNull();
  });

  it('un mes vacío POSTERIOR al corte sí lleva bajas en cero', async () => {
    const { useCase } = makeUseCase({
      getDataCutoff: vi.fn().mockResolvedValue(f('2025-01-01')),
    });

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

    const julio = punto(serie, '2025-07');

    expect(julio.ingresos).toBe(0);
    expect(julio.bajas).toBe(0);
    expect(julio.crecimientoNeto).toBe(0);
  });

  it('imputa ingresos y altas al mes en que ocurrieron', async () => {
    const { useCase } = makeUseCase();

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

    expect(punto(serie, '2026-01').ingresos).toBe(1_000_000);
    expect(punto(serie, '2026-01').altas).toBe(1);

    expect(punto(serie, '2026-02').ingresos).toBe(800_000);
    expect(punto(serie, '2026-02').altas).toBe(1);

    // Marzo: el alta de `marzo` más la renovación de `febrero`.
    expect(punto(serie, '2026-03').ingresos).toBe(1_400_000);
    expect(punto(serie, '2026-03').altas).toBe(1);
  });

  it('imputa la baja al mes en que quedó firme, no al del vencimiento', async () => {
    const { useCase } = makeUseCase();

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

    // Venció el 5 de febrero y con los 5 días de gracia la baja quedó firme el 10.
    expect(punto(serie, '2026-02').bajas).toBe(1);
    expect(punto(serie, '2026-02').crecimientoNeto).toBe(0);

    expect(punto(serie, '2026-01').bajas).toBe(0);
    expect(punto(serie, '2026-01').crecimientoNeto).toBe(1);
  });

  it('mide el MRR al cierre de cada mes y no el de hoy repetido', async () => {
    const { useCase } = makeUseCase();

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

    // Antes de que existiera ningún socio no hay cuota vigente que sumar.
    expect(punto(serie, '2025-12').mrr).toBe(0);
    // Con socios activos, cada mes tiene su propio valor.
    expect(punto(serie, '2026-03').mrr).toBeGreaterThan(0);
    expect(punto(serie, '2025-12').mrr).not.toBe(punto(serie, '2026-03').mrr);
  });

  describe('meses anteriores al corte de datos completos', () => {
    it('manda bajas y crecimiento en null, pero ingresos y altas en número', async () => {
      const { useCase } = makeUseCase({
        getDataCutoff: vi.fn().mockResolvedValue(f('2026-03-01')),
      });

      const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

      const febrero = punto(serie, '2026-02');

      // No se sabe quién estaba activo: viaja `null`, no un 0 que afirmaría que no
      // se fue nadie.
      expect(febrero.bajas).toBeNull();
      expect(febrero.crecimientoNeto).toBeNull();

      // Estos salen de datos reales y siguen siendo número.
      expect(febrero.ingresos).toBe(800_000);
      expect(febrero.altas).toBe(1);
    });

    it('a partir del corte vuelven a ser número', async () => {
      const { useCase } = makeUseCase({
        getDataCutoff: vi.fn().mockResolvedValue(f('2026-03-01')),
      });

      const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

      expect(punto(serie, '2026-03').bajas).toBe(0);
      expect(punto(serie, '2026-03').crecimientoNeto).toBe(1);
    });

    it('un gym sin ningún evento devuelve la serie completa, toda en null', async () => {
      const { useCase } = makeUseCase({
        getMembershipHistories: vi.fn().mockResolvedValue([]),
        getDataCutoff: vi.fn().mockResolvedValue(null),
      });

      const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

      expect(serie.datosCompletosDesde).toBeNull();
      expect(serie.puntos).toHaveLength(12);
      expect(serie.puntos.every((p) => p.bajas === null)).toBe(true);
      expect(serie.puntos.every((p) => p.ingresos === 0)).toBe(true);
    });
  });

  it('no cuenta como baja al que simplemente todavía no venció en el mes en curso', async () => {
    const { useCase } = makeUseCase();

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

    // Estamos el 15 de marzo. Medir "bajas hasta el 31" hoy contaría de baja a todo
    // el que no renovó todavía.
    expect(punto(serie, '2026-03').bajas).toBe(0);
  });

  describe('retención', () => {
    it('mide churn y retención con la base al INICIO de cada mes', async () => {
      const { useCase } = makeUseCase();

      const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

      // Febrero arranca con un solo socio (`enero`, que vence el 5) y lo pierde: se
      // fue el 100% de la base. La retención es 0 porque el alta de `febrero` NO
      // cuenta como retenida — es socio nuevo, no sobreviviente.
      const febrero = punto(serie, '2026-02');
      expect(febrero.churnMensual).toBe(1);
      expect(febrero.tasaRetencion).toBe(0);

      // Marzo arranca con `febrero` vigente y no pierde a nadie.
      const marzo = punto(serie, '2026-03');
      expect(marzo.churnMensual).toBe(0);
      expect(marzo.tasaRetencion).toBe(1);
    });

    it('con la base del mes en cero manda null, no 0', async () => {
      const { useCase } = makeUseCase();

      const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

      // El 1 de enero todavía no había ningún socio: no se puede dividir por esa
      // base. Un 0% de churn afirmaría que no se fue nadie de un padrón que no
      // existía.
      const enero = punto(serie, '2026-01');
      expect(enero.altas).toBe(1);
      expect(enero.churnMensual).toBeNull();
      expect(enero.tasaRetencion).toBeNull();
    });

    it('viaja en null antes del corte, igual que las bajas', async () => {
      const { useCase } = makeUseCase({
        getDataCutoff: vi.fn().mockResolvedValue(f('2026-03-01')),
      });

      const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

      const febrero = punto(serie, '2026-02');

      // Antes del corte no se sabe quién estaba activo, así que no hay ni numerador
      // ni denominador. Es la misma razón por la que `bajas` es `null`.
      expect(febrero.churnMensual).toBeNull();
      expect(febrero.tasaRetencion).toBeNull();
      expect(febrero.bajas).toBeNull();
    });

    it('no expone la cohorte de 90 días: no es una métrica del mes', async () => {
      const { useCase } = makeUseCase();

      const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 12 });

      // Es una cohorte móvil contra `now`: en un punto mensual daría el mismo valor
      // doce veces con cara de evolución.
      expect(serie.puntos[0]).not.toHaveProperty('cohorte90Dias');
    });

    it('los agrega sin volver a consultar el repositorio', async () => {
      const { useCase, metricsRepository } = makeUseCase();

      await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 24 });

      // Las dos cuentas son puras sobre el historial ya leído. Si alguna vez piden
      // una consulta propia dentro del bucle, el endpoint pierde su razón de existir.
      expect(metricsRepository.getMembershipHistories).toHaveBeenCalledTimes(1);
    });
  });

  it('cruza el año hacia atrás sin saltearse diciembre', async () => {
    const { useCase } = makeUseCase();

    const serie = await useCase.execute({ gymId: 'gym-1', now: AHORA, meses: 4 });

    expect(serie.puntos.map((p) => p.desde.toISOString().slice(0, 7))).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });
});

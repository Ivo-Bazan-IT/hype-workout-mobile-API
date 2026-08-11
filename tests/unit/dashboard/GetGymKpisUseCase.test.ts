import { describe, it, expect, vi } from 'vitest';
import { GetGymKpisUseCase } from '../../../src/application/use-cases/dashboard/GetGymKpisUseCase';
import { ValidationError } from '../../../src/shared/errors/AppError';

const f = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const AHORA = new Date('2026-03-15T12:00:00.000Z');
const MARZO = { desde: f('2026-03-01'), hasta: f('2026-04-01') };

/**
 * Cuatro socios que cubren los estados que importan en marzo:
 * vigente, en gracia, dado de baja dentro del período y alta nueva.
 */
const historiales = [
  {
    clientId: 'vigente',
    nombre: 'Vera Vigente',
    fechaAlta: f('2026-01-05'),
    windows: [{ inicio: f('2026-03-01'), vencimiento: f('2026-03-31'), monto: 1_000_000 }],
    pagos: [{ fecha: f('2026-03-01'), monto: 1_000_000 }],
  },
  {
    // Venció el 12 y estamos el 15: dentro de los 5 días de gracia.
    clientId: 'en-gracia',
    nombre: 'Ana Gracia',
    fechaAlta: f('2026-02-08'),
    windows: [{ inicio: f('2026-02-08'), vencimiento: f('2026-03-12'), monto: 800_000 }],
    pagos: [{ fecha: f('2026-02-08'), monto: 800_000 }],
  },
  {
    // Venció el 1 de marzo, la baja quedó firme el 6.
    clientId: 'de-baja',
    nombre: 'Beto Baja',
    fechaAlta: f('2026-01-20'),
    windows: [{ inicio: f('2026-01-20'), vencimiento: f('2026-03-01'), monto: 700_000 }],
    pagos: [{ fecha: f('2026-01-20'), monto: 700_000 }],
  },
  {
    clientId: 'alta-nueva',
    nombre: 'Nico Nuevo',
    fechaAlta: f('2026-03-10'),
    windows: [{ inicio: f('2026-03-10'), vencimiento: f('2026-04-09'), monto: 500_000 }],
    pagos: [{ fecha: f('2026-03-10'), monto: 500_000 }],
  },
];

function makeUseCase(overrides: Record<string, unknown> = {}) {
  const metricsRepository = {
    getMembershipHistories: vi.fn().mockResolvedValue(historiales),
    getDataCutoff: vi.fn().mockResolvedValue(f('2026-01-01')),
    // Por defecto el gym todavía no registra asistencias.
    countCheckIns: vi.fn().mockResolvedValue(0),
    getLastCheckInByClient: vi.fn().mockResolvedValue([]),
    getFirstCheckInDate: vi.fn().mockResolvedValue(null),
    // Por defecto el gym no tiene movimiento de embudo en el período.
    getLeadCohort: vi.fn().mockResolvedValue([]),
    countConversions: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as any;

  return { useCase: new GetGymKpisUseCase(metricsRepository), metricsRepository };
}

describe('GetGymKpisUseCase', () => {
  it('cuenta socios por estado de membresía, no por el campo `estado`', async () => {
    const { useCase } = makeUseCase();

    const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

    // Vigente + en gracia + alta nueva. El de baja no cuenta.
    expect(kpis.socios.activos).toBe(3);
    expect(kpis.socios.enGracia).toBe(1);
  });

  it('calcula churn, retención y crecimiento sobre la base al inicio del período', async () => {
    const { useCase } = makeUseCase();

    const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

    expect(kpis.socios.altasEnPeriodo).toBe(1);
    expect(kpis.socios.bajasEnPeriodo).toBe(1);
    expect(kpis.socios.crecimientoNeto).toBe(0);
    // 1 baja sobre los 3 que había el 1 de marzo.
    expect(kpis.retencion.churnMensual).toBeCloseTo(1 / 3);
    // (3 al cierre − 1 alta) / 3 al inicio.
    expect(kpis.retencion.tasaRetencion).toBeCloseTo(2 / 3);
  });

  it('no cuenta como baja al socio cuyo vencimiento todavía no llegó', async () => {
    const { useCase } = makeUseCase();

    // El período pedido llega hasta el 1 de abril, pero hoy es 15 de marzo. La baja
    // proyectada del socio en gracia cae el 17: contarla ahora sería adelantar un
    // churn que todavía puede no ocurrir.
    const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

    expect(kpis.socios.bajasEnPeriodo).toBe(1);
  });

  it('suma los ingresos cobrados dentro del período', async () => {
    const { useCase } = makeUseCase();

    const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

    // Solo los pagos del 1 y del 10 de marzo.
    expect(kpis.financiero.ingresosPeriodo).toBe(1_500_000);
  });

  it('normaliza cada cuota a base mensual para el MRR', async () => {
    const { useCase } = makeUseCase();

    const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

    // 1.000.000 en 30 días + 800.000 en 32 días + 500.000 en 30 días.
    expect(kpis.financiero.mrr).toBe(1_000_000 + 750_000 + 500_000);
  });

  it('deriva ARPU y LTV de lo cobrado y del churn del período', async () => {
    const { useCase } = makeUseCase();

    const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

    expect(kpis.financiero.arpu).toBe(500_000);
    expect(kpis.financiero.ltv).toBe(1_500_000);
  });

  it('censura la cohorte de 90 días mientras ninguna alta cumplió la ventana', async () => {
    const { useCase } = makeUseCase();

    const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

    // El alta más vieja es del 5 de enero: 69 días. Todavía no hay nada que medir.
    expect(kpis.retencion.cohorte90Dias).toBeNull();
  });

  describe('cuando el período empieza antes de que el historial sea completo', () => {
    it('devuelve null en retención en vez de estimarla', async () => {
      const { useCase } = makeUseCase({
        getDataCutoff: vi.fn().mockResolvedValue(f('2026-03-10')),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      expect(kpis.datosCompletosDesde).toEqual(f('2026-03-10'));
      expect(kpis.socios.bajasEnPeriodo).toBeNull();
      expect(kpis.socios.crecimientoNeto).toBeNull();
      expect(kpis.retencion.churnMensual).toBeNull();
      expect(kpis.retencion.tasaRetencion).toBeNull();
      expect(kpis.retencion.cohorte90Dias).toBeNull();
      expect(kpis.financiero.ltv).toBeNull();
    });

    it('sigue informando lo que sí es dato real: activos, altas, ingresos y MRR', async () => {
      const { useCase } = makeUseCase({
        getDataCutoff: vi.fn().mockResolvedValue(f('2026-03-10')),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      expect(kpis.socios.activos).toBe(3);
      expect(kpis.socios.altasEnPeriodo).toBe(1);
      expect(kpis.financiero.ingresosPeriodo).toBe(1_500_000);
      expect(kpis.financiero.mrr).toBe(2_250_000);
    });
  });

  it('un gym sin eventos no rompe: devuelve ceros y nulls', async () => {
    const { useCase } = makeUseCase({
      getMembershipHistories: vi.fn().mockResolvedValue([]),
      getDataCutoff: vi.fn().mockResolvedValue(null),
    });

    const kpis = await useCase.execute({ gymId: 'gym-vacio', now: AHORA, ...MARZO });

    expect(kpis.datosCompletosDesde).toBeNull();
    expect(kpis.socios.activos).toBe(0);
    expect(kpis.financiero.mrr).toBe(0);
    expect(kpis.financiero.arpu).toBeNull();
    expect(kpis.retencion.churnMensual).toBeNull();
  });

  /**
   * El corte es a medianoche UTC y se afirma con el instante exacto, no con
   * `getMonth()`/`getDate()`.
   *
   * Los getters locales leen la fecha en la zona del proceso, así que el test pasaba
   * tanto con el corte en UTC como con el corte local y no distinguía cuál de los dos
   * estaba implementado — que es justamente la ambigüedad que esta tanda cerró.
   */
  it('usa el mes calendario en curso, cortado en UTC, si no se pide un período', async () => {
    const { useCase } = makeUseCase();

    const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA });

    expect(kpis.periodo.desde.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(kpis.periodo.hasta.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('rechaza un período invertido', async () => {
    const { useCase } = makeUseCase();

    await expect(
      useCase.execute({
        gymId: 'gym-1',
        now: AHORA,
        desde: f('2026-04-01'),
        hasta: f('2026-03-01'),
      })
    ).rejects.toThrow(ValidationError);
  });

  describe('engagement', () => {
    it('viene todo en null mientras el gym no registre asistencias', async () => {
      const { useCase } = makeUseCase();

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      expect(kpis.engagement.registroDesde).toBeNull();
      expect(kpis.engagement.visitasPorSocioPorSemana).toBeNull();
      expect(kpis.engagement.enRiesgo).toBeNull();
    });

    it('calcula visitas por socio por semana y marca a los socios en riesgo', async () => {
      const { useCase } = makeUseCase({
        getFirstCheckInDate: vi.fn().mockResolvedValue(f('2026-01-01')),
        countCheckIns: vi.fn().mockResolvedValue(12),
        getLastCheckInByClient: vi.fn().mockResolvedValue([
          { clientId: 'vigente', lastCheckInAt: f('2026-03-14') },
          { clientId: 'en-gracia', lastCheckInAt: f('2026-02-20') },
        ]),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      // 12 visitas / 3 socios activos / las 14,5 días transcurridos del período
      // (del 1 de marzo a las 12:00 del 15), normalizados a semanas.
      expect(kpis.engagement.visitasPorSocioPorSemana).toBeCloseTo(12 / 3 / (14.5 / 7));
      // 'en-gracia' hace 23 días que no viene; 'alta-nueva' nunca vino.
      expect(kpis.engagement.enRiesgo).toEqual({
        total: 2,
        // Con nombre: una lista de ids no se puede llamar por teléfono, que es lo
        // único que se hace con esta métrica.
        socios: [
          { id: 'en-gracia', nombre: 'Ana Gracia' },
          { id: 'alta-nueva', nombre: 'Nico Nuevo' },
        ],
      });
    });

    it('devuelve el socio en riesgo con nombre en null si el cliente ya no existe', async () => {
      const { useCase } = makeUseCase({
        getMembershipHistories: vi
          .fn()
          .mockResolvedValue(historiales.map((h) => ({ ...h, nombre: null }))),
        getFirstCheckInDate: vi.fn().mockResolvedValue(f('2026-01-01')),
        countCheckIns: vi.fn().mockResolvedValue(12),
        getLastCheckInByClient: vi.fn().mockResolvedValue([
          { clientId: 'vigente', lastCheckInAt: f('2026-03-14') },
        ]),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      // Perder el nombre no puede hacer desaparecer al socio de la lista.
      expect(kpis.engagement.enRiesgo?.socios.every((s) => s.nombre === null)).toBe(true);
      expect(kpis.engagement.enRiesgo?.total).toBeGreaterThan(0);
    });

    it('el total acompaña a la lista de socios', async () => {
      const { useCase } = makeUseCase({
        getFirstCheckInDate: vi.fn().mockResolvedValue(f('2026-01-01')),
        countCheckIns: vi.fn().mockResolvedValue(12),
        getLastCheckInByClient: vi.fn().mockResolvedValue([]),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });
      const enRiesgo = kpis.engagement.enRiesgo!;

      // El bloque tiene una sola lista. `clientIds` se sacó el 09/08 —el front ya
      // había migrado a `socios`— y el total no puede despegarse de ella.
      expect(enRiesgo.total).toBe(enRiesgo.socios.length);
      expect(Object.keys(enRiesgo).sort()).toEqual(['socios', 'total']);
    });

    it('no acusa socios en riesgo si todavía no hay dos semanas de registro', async () => {
      const { useCase } = makeUseCase({
        getFirstCheckInDate: vi.fn().mockResolvedValue(f('2026-03-10')),
        countCheckIns: vi.fn().mockResolvedValue(9),
        getLastCheckInByClient: vi.fn().mockResolvedValue([]),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      // Con 5 días de registro, "hace 14 que no viene" sería un artefacto del sistema.
      expect(kpis.engagement.enRiesgo).toBeNull();
      // La frecuencia tampoco: 5,5 días no alcanzan para un promedio semanal, y
      // dividir igual lo convierte en una extrapolación ×1,3. Los dos umbrales son
      // distintos a propósito —7 para el promedio, 14 para el riesgo— porque afirman
      // cosas distintas.
      expect(kpis.engagement.visitasPorSocioPorSemana).toBeNull();
      // Y `registroDesde` sigue viajando: es lo que le deja al front explicar el
      // hueco con una fecha en vez de un "no hay datos".
      expect(kpis.engagement.registroDesde).toEqual(f('2026-03-10'));
    });

    it('informa la frecuencia en cuanto hay una semana de registro', async () => {
      const { useCase } = makeUseCase({
        // 8 días de registro al 15/03: ya se puede promediar por semana.
        getFirstCheckInDate: vi.fn().mockResolvedValue(f('2026-03-07')),
        countCheckIns: vi.fn().mockResolvedValue(9),
        getLastCheckInByClient: vi.fn().mockResolvedValue([]),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      // Sobre los 8,5 días con registro —no sobre los 14,5 del período—, que si no
      // saldría diluida a la mitad.
      expect(kpis.engagement.visitasPorSocioPorSemana).toBeCloseTo(9 / 3 / (8.5 / 7));
    });

    it('cuenta las asistencias solo desde que hay registro, no desde el inicio del período', async () => {
      const { useCase, metricsRepository } = makeUseCase({
        getFirstCheckInDate: vi.fn().mockResolvedValue(f('2026-03-10')),
      });

      await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      expect(metricsRepository.countCheckIns).toHaveBeenCalledWith('gym-1', {
        start: f('2026-03-10'),
        end: AHORA,
      });
    });
  });

  describe('embudo', () => {
    /** Un lead de la cohorte de marzo, con los sellos que le pongamos. */
    const lead = (
      clientId: string,
      createdAt: Date,
      opciones: {
        contactado?: Date | null;
        convertido?: boolean;
        fechaConversion?: Date | null;
      } = {}
    ) => ({
      clientId,
      createdAt,
      fechaPrimerContacto: opciones.contactado ?? null,
      fechaConversion: opciones.fechaConversion ?? null,
      convertido: opciones.convertido ?? false,
    });

    it('cuenta los leads del período y los normaliza por semana', async () => {
      const { useCase } = makeUseCase({
        getLeadCohort: vi
          .fn()
          .mockResolvedValue([
            lead('a', f('2026-03-02')),
            lead('b', f('2026-03-05')),
            lead('c', f('2026-03-11')),
          ]),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      expect(kpis.embudo.leadsNuevos).toBe(3);
      // Se normaliza sobre los 14,5 días transcurridos, no sobre el mes entero: el
      // período está en curso y contar los días futuros diluiría el ritmo real.
      expect(kpis.embudo.leadsPorSemana).toBeCloseTo(3 / (14.5 / 7));
    });

    it('separa las conversiones del período de los convertidos de la cohorte', async () => {
      const { useCase, metricsRepository } = makeUseCase({
        getLeadCohort: vi
          .fn()
          .mockResolvedValue([
            lead('convertido', f('2026-03-02'), { convertido: true }),
            lead('pendiente', f('2026-03-05')),
          ]),
        // Cinco conversiones ocurrieron en marzo, pero solo una es de la cohorte de
        // marzo: las otras cuatro son leads viejos que recién ahora contestaron.
        countConversions: vi.fn().mockResolvedValue(5),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      expect(kpis.embudo.conversionesEnPeriodo).toBe(5);
      expect(kpis.embudo.sinConvertir).toBe(1);
      // Las dos lecturas se piden sobre el tramo transcurrido, no sobre el mes entero.
      expect(metricsRepository.countConversions).toHaveBeenCalledWith('gym-1', {
        start: f('2026-03-01'),
        end: AHORA,
      });
    });

    it('censura la tasa de conversión mientras la cohorte no cumplió los 90 días', async () => {
      const { useCase } = makeUseCase({
        getLeadCohort: vi
          .fn()
          .mockResolvedValue([
            lead('a', f('2026-03-02'), { convertido: true }),
            lead('b', f('2026-03-05')),
          ]),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      // Ninguno de los dos tuvo sus 90 días todavía. Un 50% acá sería afirmar que
      // el lead del 5 de marzo ya fracasó, y recién lleva diez días.
      expect(kpis.embudo.tasaConversion).toBeNull();
      expect(kpis.embudo.ventanaConversionDias).toBe(90);
    });

    it('calcula la tasa cuando la cohorte ya maduró', async () => {
      const OCTUBRE = { desde: f('2025-10-01'), hasta: f('2025-11-01') };

      const { useCase } = makeUseCase({
        getLeadCohort: vi.fn().mockResolvedValue([
          lead('convirtio', f('2025-10-03'), {
            convertido: true,
            fechaConversion: f('2025-10-20'),
          }),
          // Convertido sin fecha: es de los anteriores a la tanda 4. Cuenta como
          // convertido igual, que es lo que efectivamente pasó.
          lead('convirtio-sin-fecha', f('2025-10-08'), { convertido: true }),
          lead('nunca', f('2025-10-11')),
          lead('tampoco', f('2025-10-15')),
        ]),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...OCTUBRE });

      expect(kpis.embudo.tasaConversion).toBe(0.5);
    });

    it('promedia el tiempo de respuesta solo sobre los leads contactados', async () => {
      const { useCase } = makeUseCase({
        getLeadCohort: vi.fn().mockResolvedValue([
          lead('rapido', new Date('2026-03-02T10:00:00.000Z'), {
            contactado: new Date('2026-03-02T10:30:00.000Z'),
          }),
          lead('lento', new Date('2026-03-05T10:00:00.000Z'), {
            contactado: new Date('2026-03-05T11:30:00.000Z'),
          }),
          // Nunca contactado: es un problema de cobertura, no de velocidad. Si
          // entrara al promedio, mezclaría dos diagnósticos con acciones distintas.
          lead('olvidado', f('2026-03-06')),
        ]),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

      expect(kpis.embudo.tiempoRespuestaMinutos).toBe(60);
      expect(kpis.embudo.sinContactar).toBe(1);
    });

    it('viaja también cuando el período es anterior al corte de datos', async () => {
      const ENERO = { desde: f('2026-01-01'), hasta: f('2026-02-01') };

      const { useCase } = makeUseCase({
        getDataCutoff: vi.fn().mockResolvedValue(f('2026-02-15')),
        getLeadCohort: vi.fn().mockResolvedValue([lead('a', f('2026-01-10'))]),
        countConversions: vi.fn().mockResolvedValue(2),
      });

      const kpis = await useCase.execute({ gymId: 'gym-1', now: AHORA, ...ENERO });

      // La retención se apaga porque depende del stream de eventos, pero el embudo
      // sale de `Client` y es dato real igual: no tiene por qué venir en null.
      expect(kpis.retencion.churnMensual).toBeNull();
      expect(kpis.embudo.leadsNuevos).toBe(1);
      expect(kpis.embudo.conversionesEnPeriodo).toBe(2);
    });
  });

  it('pide el historial del gym del tenant y de ningún otro', async () => {
    const { useCase, metricsRepository } = makeUseCase();

    await useCase.execute({ gymId: 'gym-1', now: AHORA, ...MARZO });

    expect(metricsRepository.getMembershipHistories).toHaveBeenCalledWith('gym-1');
    expect(metricsRepository.getDataCutoff).toHaveBeenCalledWith('gym-1');
  });
});

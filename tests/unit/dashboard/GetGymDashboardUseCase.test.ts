import { describe, it, expect, vi } from 'vitest';
import { GetGymDashboardUseCase } from '../../../src/application/use-cases/dashboard/GetGymDashboardUseCase';
import { DIAS_DE_GRACIA_POR_DEFECTO } from '../../../src/domain/kpis/membership';

const AHORA = new Date('2026-03-15T12:00:00.000Z');

/** El vencimiento más viejo que todavía cuenta como activo: `AHORA` menos la gracia. */
const LIMITE_DE_GRACIA = new Date('2026-03-10T12:00:00.000Z');

describe('GetGymDashboardUseCase', () => {
  it('should return dashboard metrics', async () => {
    const mockClientRepo = {
      count: vi.fn(async (_gymId: string, filters: any) =>
        filters.esRecurrente === true ? 2 : 3
      ),
    } as any;

    const mockRoutineRepo = {
      countExpiringByDay: async (_gymId: string, days: number) => days === 7 ? 5 : days === 5 ? 3 : 1,
      countBySendStatus: async () => 4
    } as any;

    const mockInvoiceRepo = {
      sumRevenueByMonth: async () => 50000
    } as any;

    const useCase = new GetGymDashboardUseCase(
      mockClientRepo,
      mockRoutineRepo,
      mockInvoiceRepo
    );

    const result = await useCase.execute('gym-123', AHORA);

    expect(result.clientesActivos).toBe(3);
    expect(result.clientesRecurrentes).toBe(2);
    expect(result.rutinasPorVencer.en7Dias).toBe(5);
    expect(result.rutinasPorVencer.en5Dias).toBe(3);
    expect(result.rutinasPorVencer.en3Dias).toBe(1);
    expect(result.ingresos.mesActual).toBe(50000);
    expect(result.ingresos.mesPrevio).toBe(50000);
    // Rutinas generadas que nunca salieron hacia el socio.
    expect(result.rutinasSinEnviar).toBe(4);
  });

  it('cuenta como sin enviar solo las rutinas en estado `pendiente`', async () => {
    const mockClientRepo = { count: vi.fn().mockResolvedValue(0) } as any;
    const mockRoutineRepo = {
      countExpiringByDay: async () => 0,
      countBySendStatus: vi.fn().mockResolvedValue(2),
    } as any;
    const mockInvoiceRepo = { sumRevenueByMonth: async () => 0 } as any;

    const useCase = new GetGymDashboardUseCase(mockClientRepo, mockRoutineRepo, mockInvoiceRepo);

    const result = await useCase.execute('gym-123', AHORA);

    // `enviando` y `error` no cuentan: la primera está en curso y la segunda ya
    // salió y falló, que es otro problema con otra acción.
    expect(mockRoutineRepo.countBySendStatus).toHaveBeenCalledWith('gym-123', 'pendiente');
    expect(result.rutinasSinEnviar).toBe(2);
  });

  it('un gym sin rutinas trabadas devuelve 0, que acá es un dato real', async () => {
    const mockClientRepo = { count: vi.fn().mockResolvedValue(0) } as any;
    const mockRoutineRepo = {
      countExpiringByDay: async () => 0,
      countBySendStatus: async () => 0,
    } as any;
    const mockInvoiceRepo = { sumRevenueByMonth: async () => 0 } as any;

    const useCase = new GetGymDashboardUseCase(mockClientRepo, mockRoutineRepo, mockInvoiceRepo);

    const result = await useCase.execute('gym-123', AHORA);

    // A diferencia del resto de los huecos del tablero, este 0 significa "no hay
    // ninguna trabada" y no "no se pudo calcular": va como número, no como null.
    expect(result.rutinasSinEnviar).toBe(0);
  });

  it('should count 0 recurring clients when all are first-time', async () => {
    const mockClientRepo = {
      count: vi.fn(async (_gymId: string, filters: any) =>
        filters.esRecurrente === true ? 0 : 2
      ),
    } as any;

    const mockRoutineRepo = {
      countExpiringByDay: async () => 0,
      countBySendStatus: async () => 0
    } as any;

    const mockInvoiceRepo = {
      sumRevenueByMonth: async () => 0
    } as any;

    const useCase = new GetGymDashboardUseCase(
      mockClientRepo,
      mockRoutineRepo,
      mockInvoiceRepo
    );

    const result = await useCase.execute('gym-123', AHORA);

    expect(result.clientesRecurrentes).toBe(0);
  });

  it('cuenta en la base en vez de paginar y filtrar en memoria', async () => {
    const mockClientRepo = { count: vi.fn().mockResolvedValue(0), search: vi.fn() } as any;
    const mockRoutineRepo = { countExpiringByDay: async () => 0, countBySendStatus: async () => 0 } as any;
    const mockInvoiceRepo = { sumRevenueByMonth: async () => 0 } as any;

    const useCase = new GetGymDashboardUseCase(mockClientRepo, mockRoutineRepo, mockInvoiceRepo);

    await useCase.execute('gym-123', AHORA);

    expect(mockClientRepo.search).not.toHaveBeenCalled();
    expect(mockClientRepo.count).toHaveBeenCalledWith('gym-123', {
      estado: 'activo',
      vencimientoDesde: LIMITE_DE_GRACIA,
    });
    expect(mockClientRepo.count).toHaveBeenCalledWith('gym-123', {
      estado: 'activo',
      vencimientoDesde: LIMITE_DE_GRACIA,
      esRecurrente: true,
    });
  });

  it('cuenta como activo al socio en gracia y descarta al vencido fuera de ella', async () => {
    // Padrón del gym: 3 registros no eliminados, con estos vencimientos.
    const padron = [
      { vencimiento: new Date('2026-04-01T00:00:00.000Z') }, // vigente
      { vencimiento: new Date('2026-03-12T00:00:00.000Z') }, // venció hace 3 días: en gracia
      { vencimiento: new Date('2026-02-03T00:00:00.000Z') }, // venció hace 40 días: de baja
    ];

    const mockClientRepo = {
      count: vi.fn(async (_gymId: string, filters: any) => {
        const desde: Date = filters.vencimientoDesde;
        return padron.filter((c) => c.vencimiento.getTime() >= desde.getTime()).length;
      }),
    } as any;
    const mockRoutineRepo = {
      countExpiringByDay: async () => 0,
      countBySendStatus: async () => 0,
    } as any;
    const mockInvoiceRepo = { sumRevenueByMonth: async () => 0 } as any;

    const useCase = new GetGymDashboardUseCase(mockClientRepo, mockRoutineRepo, mockInvoiceRepo);

    const result = await useCase.execute('gym-123', AHORA);

    // Los tres siguen en la base y ninguno está borrado; activos son dos. Este es el
    // mismo número que `socios.activos` de `/dashboard/kpis`, que también cuenta la
    // gracia como actividad.
    expect(result.clientesActivos).toBe(2);
  });

  it('la gracia sale de la constante del dominio, no de un 5 escrito a mano', async () => {
    const mockClientRepo = { count: vi.fn().mockResolvedValue(0) } as any;
    const mockRoutineRepo = {
      countExpiringByDay: async () => 0,
      countBySendStatus: async () => 0,
    } as any;
    const mockInvoiceRepo = { sumRevenueByMonth: async () => 0 } as any;

    const useCase = new GetGymDashboardUseCase(mockClientRepo, mockRoutineRepo, mockInvoiceRepo);

    await useCase.execute('gym-123', AHORA);

    // Si la gracia del dominio cambia, este endpoint tiene que moverse con ella o
    // vuelve a contradecir a `/dashboard/kpis`.
    const { vencimientoDesde } = mockClientRepo.count.mock.calls[0][1];
    const diasDeDiferencia =
      (AHORA.getTime() - vencimientoDesde.getTime()) / (24 * 60 * 60 * 1000);
    expect(diasDeDiferencia).toBe(DIAS_DE_GRACIA_POR_DEFECTO);
  });

  it('toma el mes del `now` inyectado y no del reloj del sistema', async () => {
    const mockClientRepo = { count: vi.fn().mockResolvedValue(0) } as any;
    const mockRoutineRepo = { countExpiringByDay: async () => 0, countBySendStatus: async () => 0 } as any;
    const mockInvoiceRepo = { sumRevenueByMonth: vi.fn().mockResolvedValue(0) } as any;

    const useCase = new GetGymDashboardUseCase(mockClientRepo, mockRoutineRepo, mockInvoiceRepo);

    await useCase.execute('gym-123', new Date('2026-01-10T00:00:00.000Z'));

    // Enero: el mes previo es diciembre del año anterior.
    expect(mockInvoiceRepo.sumRevenueByMonth).toHaveBeenCalledWith('gym-123', 2026, 1);
    expect(mockInvoiceRepo.sumRevenueByMonth).toHaveBeenCalledWith('gym-123', 2025, 12);
  });
});

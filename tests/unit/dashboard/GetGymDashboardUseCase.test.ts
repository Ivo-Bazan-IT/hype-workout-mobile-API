import { describe, it, expect } from 'vitest';
import { GetGymDashboardUseCase } from '../../../src/application/use-cases/dashboard/GetGymDashboardUseCase';

describe('GetGymDashboardUseCase', () => {
  it('should return dashboard metrics', async () => {
    const mockClientRepo = {
      search: async () => ({
        data: [
          { esRecurrente: false },
          { esRecurrente: true },
          { esRecurrente: true }
        ],
        total: 3,
        page: 1,
        limit: 1000,
        totalPages: 1
      })
    } as any;

    const mockRoutineRepo = {
      countExpiringByDay: async (_gymId: string, days: number) => days === 7 ? 5 : days === 5 ? 3 : 1
    } as any;

    const mockInvoiceRepo = {
      sumRevenueByMonth: async () => 50000
    } as any;

    const useCase = new GetGymDashboardUseCase(
      mockClientRepo,
      mockRoutineRepo,
      mockInvoiceRepo
    );

    const result = await useCase.execute('gym-123');

    expect(result.clientesActivos).toBe(3);
    expect(result.clientesRecurrentes).toBe(2);
    expect(result.rutinasPorVencer.en7Dias).toBe(5);
    expect(result.rutinasPorVencer.en5Dias).toBe(3);
    expect(result.rutinasPorVencer.en3Dias).toBe(1);
    expect(result.ingresos.mesActual).toBe(50000);
    expect(result.ingresos.mesPrevio).toBe(50000);
  });

  it('should count 0 recurring clients when all are first-time', async () => {
    const mockClientRepo = {
      search: async () => ({
        data: [
          { esRecurrente: false },
          { esRecurrente: false }
        ],
        total: 2,
        page: 1,
        limit: 1000,
        totalPages: 1
      })
    } as any;

    const mockRoutineRepo = {
      countExpiringByDay: async () => 0
    } as any;

    const mockInvoiceRepo = {
      sumRevenueByMonth: async () => 0
    } as any;

    const useCase = new GetGymDashboardUseCase(
      mockClientRepo,
      mockRoutineRepo,
      mockInvoiceRepo
    );

    const result = await useCase.execute('gym-123');

    expect(result.clientesRecurrentes).toBe(0);
  });
});
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { IInvoiceRepository } from '../../../domain/repositories/IInvoiceRepository';

interface DashboardMetrics {
  clientesActivos: number;
  clientesRecurrentes: number;
  rutinasPorVencer: {
    en7Dias: number;
    en5Dias: number;
    en3Dias: number;
  };
  ingresos: {
    mesActual: number;
    mesPrevio: number;
  };
}

export class GetGymDashboardUseCase {
  constructor(
    private clientRepository: IClientRepository,
    private routineRepository: IRoutineRepository,
    private invoiceRepository: IInvoiceRepository
  ) {}

  async execute(gymId: string): Promise<DashboardMetrics> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    // Contar clientes activos
    const clientesActivosResult = await this.clientRepository.search(gymId, {
      estado: 'activo'
    }, 1, 1);
    const clientesActivos = clientesActivosResult.total;

    // Contar clientes recurrentes - usamos query directa y filtramos
    const allActiveClients = await this.clientRepository.search(gymId, {
      estado: 'activo'
    }, 1, 1000);

    const clientesRecurrentes = allActiveClients.data.filter(c => c.esRecurrente).length;

    // Rutinas por vencer (7, 5 y 3 días)
    const [en7Dias, en5Dias, en3Dias] = await Promise.all([
      this.routineRepository.countExpiringByDay(gymId, 7),
      this.routineRepository.countExpiringByDay(gymId, 5),
      this.routineRepository.countExpiringByDay(gymId, 3)
    ]);

    // Ingresos mensuales
    const [ingresoMesActual, ingresoMesPrevio] = await Promise.all([
      this.invoiceRepository.sumRevenueByMonth(gymId, currentYear, currentMonth),
      this.invoiceRepository.sumRevenueByMonth(gymId, previousYear, previousMonth)
    ]);

    return {
      clientesActivos,
      clientesRecurrentes,
      rutinasPorVencer: {
        en7Dias,
        en5Dias,
        en3Dias
      },
      ingresos: {
        mesActual: ingresoMesActual,
        mesPrevio: ingresoMesPrevio
      }
    };
  }
}
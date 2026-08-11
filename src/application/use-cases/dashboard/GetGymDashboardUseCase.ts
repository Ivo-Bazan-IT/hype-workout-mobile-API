import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { IInvoiceRepository } from '../../../domain/repositories/IInvoiceRepository';
import { DIAS_DE_GRACIA_POR_DEFECTO } from '../../../domain/kpis/membership';
import { MS_POR_DIA } from '../../../domain/kpis/types';

interface DashboardMetrics {
  /**
   * Socios con la cuota vigente o dentro del período de gracia.
   *
   * Es el mismo universo que `socios.activos` de `GET /dashboard/kpis`, y tiene que
   * seguir siéndolo: las dos cifras conviven en la misma pantalla —una en el bloque
   * "Hoy", la otra como denominador de "socios recurrentes"— y un tablero que se
   * contradice a sí mismo se descarta entero, aunque el resto esté bien.
   */
  clientesActivos: number;
  /** Subconjunto de `clientesActivos` que ya renovó al menos dos veces. */
  clientesRecurrentes: number;
  rutinasPorVencer: {
    en7Dias: number;
    en5Dias: number;
    en3Dias: number;
  };
  /**
   * Rutinas generadas que todavía no salieron hacia el socio.
   *
   * Un 0 acá SÍ es un dato real —"no hay ninguna trabada"— y no un hueco: por eso va
   * como número y no como `null`. Hasta que existió este campo el front pintaba un
   * guión, porque un 0 inventado habría afirmado justo lo que nadie había medido.
   */
  rutinasSinEnviar: number;
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

  async execute(gymId: string, now: Date): Promise<DashboardMetrics> {
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    // Los dos conteos se resuelven en la base. Antes el de recurrentes traía hasta
    // 1000 clientes para filtrarlos en memoria, así que el gym número 1001 empezaba
    // a reportar de menos sin que nada fallara.
    //
    // `estado: 'activo'` NO es el estado de la membresía: es el flag del borrado
    // lógico (ver el encabezado de `domain/kpis/membership`). Se conserva porque es
    // lo único que ese campo sabe decir —excluye los registros eliminados— pero el
    // que decide si el socio está activo es el vencimiento: sin este segundo filtro
    // el tablero contaba como activo a quien venció hace ocho meses.
    const filtroDeVigencia = {
      estado: 'activo' as const,
      vencimientoDesde: this.limiteDeGracia(now)
    };

    const [clientesActivos, clientesRecurrentes] = await Promise.all([
      this.clientRepository.count(gymId, filtroDeVigencia),
      // El mismo filtro, y no es opcional: la tarjeta se lee "1 de 3 activos". Si el
      // denominador contara vigentes y el numerador no-eliminados, el numerador
      // podría quedar por fuera del denominador y hasta superarlo.
      this.clientRepository.count(gymId, { ...filtroDeVigencia, esRecurrente: true })
    ]);

    // Rutinas por vencer (7, 5 y 3 días) y las que quedaron sin enviar
    const [en7Dias, en5Dias, en3Dias, rutinasSinEnviar] = await Promise.all([
      this.routineRepository.countExpiringByDay(gymId, 7),
      this.routineRepository.countExpiringByDay(gymId, 5),
      this.routineRepository.countExpiringByDay(gymId, 3),
      this.routineRepository.countBySendStatus(gymId, 'pendiente')
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
      rutinasSinEnviar,
      ingresos: {
        mesActual: ingresoMesActual,
        mesPrevio: ingresoMesPrevio
      }
    };
  }

  /**
   * El vencimiento más viejo que todavía cuenta como socio activo.
   *
   * La gracia no se escribe a mano: sale de `DIAS_DE_GRACIA_POR_DEFECTO`, la misma
   * constante que usa `isActiveAt` para los KPIs. Si algún día la gracia cambia, los
   * dos endpoints se mueven juntos o vuelven a contradecirse.
   */
  private limiteDeGracia(now: Date): Date {
    return new Date(now.getTime() - DIAS_DE_GRACIA_POR_DEFECTO * MS_POR_DIA);
  }
}
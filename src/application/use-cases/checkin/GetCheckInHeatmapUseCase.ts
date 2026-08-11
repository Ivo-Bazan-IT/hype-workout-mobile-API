import {
  HeatmapCell,
  ICheckInRepository,
} from '../../../domain/repositories/ICheckInRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IMetricsRepository } from '../../../domain/repositories/IMetricsRepository';
import { DIAS_POR_SEMANA } from '../../../domain/kpis/types';
import { ZONA_HORARIA_DEFAULT, ultimosDiasEn } from '../../../domain/time/zonaHoraria';

interface GetCheckInHeatmapDTO {
  gymId: string;
  /** Se inyecta desde el borde HTTP: el caso de uso no lee el reloj. */
  now: Date;
  semanas: number;
}

export interface CheckInHeatmap {
  /** La zona efectivamente usada para agrupar, sea la del gym o el default. */
  zonaHoraria: string;
  /** Ventana analizada, semiabierta: `hasta` es exclusivo. */
  desde: Date;
  hasta: Date;
  /**
   * Desde cuándo el gym registra asistencias, o `null` si nunca registró ninguna.
   *
   * Es lo que le permite al front distinguir las dos cosas que una celda vacía puede
   * significar: *nadie entró un domingo a las 6* —cero real, se pinta— y *el gimnasio
   * todavía no registraba asistencias* —sin dato, se raya—. Sin este campo las dos se
   * dibujan igual y el mapa afirma un hecho que nadie midió.
   */
  registroDesde: Date | null;
  celdas: HeatmapCell[];
}

/**
 * La semana del gimnasio en una grilla día × hora: cuándo se llena.
 *
 * El agrupado lo hace la base (ver `ICheckInRepository.getHeatmap`), no este caso de
 * uso: acá se resuelve la ventana, la zona horaria y desde cuándo hay registro, que
 * es lo que le da sentido a las celdas.
 */
export class GetCheckInHeatmapUseCase {
  constructor(
    private checkInRepository: ICheckInRepository,
    private gymRepository: IGymRepository,
    private metricsRepository: IMetricsRepository
  ) {}

  async execute(dto: GetCheckInHeatmapDTO): Promise<CheckInHeatmap> {
    const gym = await this.gymRepository.findById(dto.gymId);
    const zonaHoraria = gym?.timezone ?? ZONA_HORARIA_DEFAULT;

    // La ventana se recorta en días del GIMNASIO, no en múltiplos de 24 horas desde
    // ahora: un mapa que arranca un martes a las 14:30 mezcla media franja de un día
    // con media del otro y las columnas dejan de ser comparables.
    const ventana = ultimosDiasEn(dto.now, dto.semanas * DIAS_POR_SEMANA, zonaHoraria);

    const [celdas, registroDesde] = await Promise.all([
      this.checkInRepository.getHeatmap(dto.gymId, ventana, zonaHoraria),
      // Mismo puerto que usa `/dashboard/kpis` para `engagement.registroDesde`: el
      // dato es el mismo y no hay razón para tener dos formas de averiguarlo.
      this.metricsRepository.getFirstCheckInDate(dto.gymId),
    ]);

    return {
      zonaHoraria,
      desde: ventana.start,
      hasta: ventana.end,
      registroDesde,
      celdas,
    };
  }
}

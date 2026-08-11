import { IMetricsRepository } from '../../../domain/repositories/IMetricsRepository';
import { ClientMembershipHistory } from '../../../domain/repositories/IMetricsRepository';
import { Cents, DateRange, Rate } from '../../../domain/kpis/types';
import {
  activeMembersAt,
  churnedMembersIn,
  mrrAt,
  newMembersIn,
  revenueIn,
} from '../../../domain/kpis/periodAggregates';
import { monthlyChurnRate, retentionRate } from '../../../domain/kpis/retention';
import { netMemberGrowth } from '../../../domain/kpis/funnel';

interface GetGymKpisSeriesDTO {
  gymId: string;
  /** Se inyecta desde el borde HTTP: el caso de uso no lee el reloj. */
  now: Date;
  meses: number;
}

export interface GymKpisSeriesPoint {
  /** Rango semiabierto `[desde, hasta)`, cortado a medianoche UTC. */
  desde: Date;
  hasta: Date;
  ingresos: Cents;
  mrr: Cents;
  altas: number;
  /** `null` en los meses anteriores a `datosCompletosDesde`: el dato no existe. */
  bajas: number | null;
  crecimientoNeto: number | null;
  /**
   * Fracción `[0,1]`, sin formatear. `null` por el mismo motivo que `bajas` —antes
   * del corte no se sabe quién estaba activo— y además cuando el mes arranca con la
   * base en cero: dividir por cero no da 0% de churn, no da nada.
   */
  churnMensual: Rate | null;
  tasaRetencion: Rate | null;
}

export interface GymKpisSeries {
  datosCompletosDesde: Date | null;
  puntos: GymKpisSeriesPoint[];
}

/**
 * Evolución mensual de los KPIs del gym.
 *
 * Reemplaza las doce llamadas en paralelo a `/dashboard/kpis` que el front hacía
 * para dibujar una gráfica de doce puntos. **La razón de existir del endpoint es que
 * las doce cuentas salen de UNA sola lectura del historial**, no de doce: si alguna
 * vez este caso de uso vuelve a consultar el repositorio dentro del bucle, deja de
 * tener sentido y conviene borrarlo. Hay un test que lo verifica contando
 * invocaciones al puerto.
 *
 * Se apoya en las mismas funciones de `domain/kpis/periodAggregates` que
 * `GetGymKpisUseCase`, así que el punto del mes en curso coincide con lo que
 * devuelve `/dashboard/kpis` sin parámetros. Eso es contrato, no coincidencia: dos
 * pantallas que muestran el mismo mes tienen que mostrar el mismo número.
 *
 * `churnMensual` y `tasaRetencion` sí van en la serie: son funciones puras sobre el
 * historial ya leído, así que no cuestan una consulta más.
 *
 * `cohorte90Dias` NO va, y no es un olvido: es una cohorte móvil medida contra
 * `now`, no una métrica del mes. Ponerla en un punto mensual repetiría el mismo
 * valor doce veces con cara de evolución. La versión que tendría sentido —la cohorte
 * *de cada mes*— es otro cálculo, no este campo movido de lugar.
 */
export class GetGymKpisSeriesUseCase {
  constructor(private metricsRepository: IMetricsRepository) {}

  async execute(dto: GetGymKpisSeriesDTO): Promise<GymKpisSeries> {
    // UNA lectura para todos los meses. Ver el comentario de la clase.
    const [historiales, corte] = await Promise.all([
      this.metricsRepository.getMembershipHistories(dto.gymId),
      this.metricsRepository.getDataCutoff(dto.gymId),
    ]);

    const puntos = this.mesesHaciaAtras(dto.now, dto.meses).map((rango) =>
      this.calcularPunto({ rango, historiales, corte, now: dto.now })
    );

    return { datosCompletosDesde: corte, puntos };
  }

  /**
   * Los meses salen del calendario, no de los datos.
   *
   * Es lo que garantiza que un mes sin ninguna actividad viaje igual, con sus ceros
   * reales. Un mes ausente del array y un mes con valores en cero se dibujan
   * distinto —el primero traza una recta que atraviesa el hueco— y el front no puede
   * distinguirlos si el punto no está.
   *
   * Del más viejo al más nuevo: la gráfica se lee de izquierda a derecha.
   */
  private mesesHaciaAtras(now: Date, cantidad: number): DateRange[] {
    const año = now.getUTCFullYear();
    const mes = now.getUTCMonth();

    return Array.from({ length: cantidad }, (_, i) => {
      const desplazamiento = cantidad - 1 - i;

      return {
        // `Date.UTC` normaliza el desborde, así que restarle 13 meses a enero cae en
        // diciembre del año anterior sin que haya que hacer la cuenta a mano.
        start: new Date(Date.UTC(año, mes - desplazamiento, 1)),
        end: new Date(Date.UTC(año, mes - desplazamiento + 1, 1)),
      };
    });
  }

  private calcularPunto(input: {
    rango: DateRange;
    historiales: ReadonlyArray<ClientMembershipHistory>;
    corte: Date | null;
    now: Date;
  }): GymKpisSeriesPoint {
    const { rango, historiales, corte, now } = input;

    // Un mes en curso todavía no terminó: medir "bajas hasta el 31" el día 12
    // contaría como baja a todo el que simplemente no venció aún. Mismo criterio
    // que `/dashboard/kpis`.
    const hasta = rango.end.getTime() <= now.getTime() ? rango.end : now;
    const transcurrido: DateRange = { start: rango.start, end: hasta };

    const altas = newMembersIn(historiales, transcurrido);

    // Antes del corte no se sabe quién estaba activo: las renovaciones previas a la
    // siembra no registraron vencimiento, así que no dibujan ventana y una baja que
    // existió sería invisible. Viaja `null` en vez de un 0 que afirmaría que no se
    // fue nadie.
    const baseConfiable = corte !== null && rango.start.getTime() >= corte.getTime();
    const bajas = baseConfiable ? churnedMembersIn(historiales, transcurrido) : null;

    // Las mismas dos cuentas que hace `/dashboard/kpis` con el mismo período, para que
    // el punto del mes en curso coincida con lo que muestra el tablero. Son puras
    // sobre `historiales`: no agregan una sola lectura al repositorio, que es la
    // condición para que este endpoint siga teniendo razón de ser.
    const membersAtStart = baseConfiable ? activeMembersAt(historiales, rango.start) : null;

    return {
      desde: rango.start,
      hasta: rango.end,
      // Ingresos y altas son dato real incluso antes del corte: salen de los pagos y
      // de la fecha de alta, no de reconstruir ventanas.
      ingresos: revenueIn(historiales, transcurrido),
      // MRR al cierre de SU mes, no al de hoy: cada punto tiene que describir el mes
      // que representa, o la línea sería una recta con el valor actual repetido.
      mrr: mrrAt(historiales, hasta),
      altas,
      bajas,
      crecimientoNeto:
        bajas === null ? null : netMemberGrowth({ newMembers: altas, churnedMembers: bajas }),
      churnMensual:
        membersAtStart === null || bajas === null
          ? null
          : monthlyChurnRate({ membersAtStart, cancelledDuringPeriod: bajas }),
      tasaRetencion:
        membersAtStart === null
          ? null
          : retentionRate({
              membersAtStart,
              membersAtEnd: activeMembersAt(historiales, hasta),
              newMembersInPeriod: altas,
            }),
    };
  }
}

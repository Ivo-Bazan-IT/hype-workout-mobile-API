import {
  IMetricsRepository,
  ClientMembershipHistory,
  MemberLastCheckIn,
} from '../../../domain/repositories/IMetricsRepository';
import { Cents, DateRange, Rate, diasEntre } from '../../../domain/kpis/types';
import { avgVisitsPerMemberPerWeek, findAtRiskMembers } from '../../../domain/kpis/engagement';
import { firstChurnDate, isActiveAt, membershipStatusAt } from '../../../domain/kpis/membership';
import {
  CohortMember,
  cohortRetention,
  monthlyChurnRate,
  retentionRate,
} from '../../../domain/kpis/retention';
import { arpu, lifetimeValue } from '../../../domain/kpis/financial';
import {
  activeMembersAt,
  churnedMembersIn,
  mrrAt,
  newMembersIn,
  revenueIn,
} from '../../../domain/kpis/periodAggregates';
import {
  LeadRecord,
  avgLeadResponseMinutes,
  cohortConversionRate,
  netMemberGrowth,
  newLeadsPerWeek,
} from '../../../domain/kpis/funnel';
import { ValidationError } from '../../../shared/errors/AppError';

interface GetGymKpisDTO {
  gymId: string;
  /** Se inyecta desde el borde HTTP: el caso de uso no lee el reloj. */
  now: Date;
  desde?: Date;
  hasta?: Date;
}

export interface GymKpis {
  periodo: { desde: Date; hasta: Date };
  /**
   * Desde cuándo el historial es completo. Los KPIs de retención de un período
   * anterior a esta fecha vienen en `null`: el dato no existe y no se estima.
   */
  datosCompletosDesde: Date | null;
  socios: {
    activos: number;
    enGracia: number;
    altasEnPeriodo: number;
    bajasEnPeriodo: number | null;
    crecimientoNeto: number | null;
  };
  retencion: {
    churnMensual: Rate | null;
    tasaRetencion: Rate | null;
    cohorte90Dias: Rate | null;
  };
  financiero: {
    ingresosPeriodo: Cents;
    mrr: Cents;
    arpu: Cents | null;
    ltv: Cents | null;
  };
  engagement: {
    /** `null` mientras el gym no haya registrado ninguna asistencia. */
    visitasPorSocioPorSemana: number | null;
    /**
     * `null` hasta que haya al menos `DIAS_SIN_ASISTIR_PARA_RIESGO` de registro.
     *
     * Los socios viajan con nombre porque el consumidor de esta lista es una campaña
     * —un llamado, un WhatsApp—: una lista de ids no se puede llamar por teléfono.
     */
    enRiesgo: {
      total: number;
      socios: Array<{ id: string; nombre: string | null }>;
    } | null;
    /** Desde cuándo el gym registra asistencias. */
    registroDesde: Date | null;
  };
  embudo: {
    /**
     * Prospectos que entraron al embudo en el período: las altas de `Client`.
     * Incluye a los que convirtieron el mismo día —quien llega por Google Forms
     * trae la encuesta puesta— porque igual entraron al embudo.
     */
    leadsNuevos: number;
    /** `leadsNuevos` normalizado a semana. Benchmark boutique: 5–15. */
    leadsPorSemana: number | null;
    /**
     * Conversiones ocurridas DENTRO del período, sin importar cuándo entró el lead.
     * Es otra lectura que `leadsNuevos` convertidos: un lead de enero que contesta
     * en marzo suma a la cohorte de enero y a las conversiones de marzo.
     */
    conversionesEnPeriodo: number;
    /** De la cohorte del período, cuántos siguen sin contestar la encuesta hoy. */
    sinConvertir: number;
    /**
     * De la cohorte del período, cuántos nunca fueron contactados. Es un problema de
     * cobertura, no de velocidad, y por eso no entra en `tiempoRespuestaMinutos`.
     */
    sinContactar: number;
    /**
     * Conversión de la cohorte que ya tuvo sus `ventanaConversionDias` completos.
     *
     * **Viene en `null` para el período por defecto y eso es correcto:** ningún lead
     * del mes en curso cumplió todavía la ventana de 90 días, y contarlo como no
     * convertido leería el embudo peor de lo que es. Para ver movimiento del día a
     * día están `leadsNuevos` y `conversionesEnPeriodo`, que son dato crudo.
     */
    tasaConversion: Rate | null;
    ventanaConversionDias: number;
    /**
     * Minutos promedio hasta el primer contacto, sobre los leads efectivamente
     * contactados. `null` si a ninguno de la cohorte se lo contactó.
     */
    tiempoRespuestaMinutos: number | null;
  };
}

const VENTANA_COHORTE_DIAS = 90;

/**
 * Cuánto se le da a un lead para convertir antes de contarlo como perdido. Mismos
 * 90 días que la cohorte de retención, y por la misma razón: es la ventana del
 * onboarding, la que decide si la relación arranca o no.
 */
const VENTANA_CONVERSION_DIAS = 90;

/**
 * Dos semanas sin aparecer es riesgo alto de baja. Es el umbral que la literatura
 * usa y el que deja margen para intervenir antes de que el socio decida irse.
 */
const DIAS_SIN_ASISTIR_PARA_RIESGO = 14;

/**
 * KPIs de retención y financieros del gym.
 *
 * Solo orquesta: pide el historial al puerto y deja que las funciones de
 * `domain/kpis/` hagan cada cuenta. No hay una sola fórmula escrita acá, y es a
 * propósito — el día que se discuta cómo se mide el churn, se discute en un solo
 * archivo del dominio.
 *
 * El bloque de capacidad no se expone todavía: depende de clases y reservas, que no
 * existen como entidades.
 */
export class GetGymKpisUseCase {
  constructor(private metricsRepository: IMetricsRepository) {}

  async execute(dto: GetGymKpisDTO): Promise<GymKpis> {
    const periodo = this.resolverPeriodo(dto);

    // Un período en curso todavía no terminó: medir "bajas hasta el 31" el día 12
    // contaría como baja a todo el que simplemente no venció aún.
    const hasta = this.elMenor(periodo.end, dto.now);
    const transcurrido: DateRange = { start: periodo.start, end: hasta };

    const [historiales, corte, asistencias, registroDesde, leads, conversiones] =
      await Promise.all([
        this.metricsRepository.getMembershipHistories(dto.gymId),
        this.metricsRepository.getDataCutoff(dto.gymId),
        this.metricsRepository.getLastCheckInByClient(dto.gymId),
        this.metricsRepository.getFirstCheckInDate(dto.gymId),
        this.metricsRepository.getLeadCohort(dto.gymId, transcurrido),
        this.metricsRepository.countConversions(dto.gymId, transcurrido),
      ]);

    const activos = activeMembersAt(historiales, dto.now);
    const enGracia = historiales.filter(
      (h) => membershipStatusAt({ windows: h.windows, at: dto.now }) === 'en_gracia'
    ).length;

    // El alta es dato real incluso antes del corte: sale de `fechaInicio`.
    const altas = newMembersIn(historiales, transcurrido);

    const ingresos = revenueIn(historiales, transcurrido);
    const mrrActual = mrrAt(historiales, dto.now);

    // ARPU contra los socios de hoy y no contra la base al cierre: el cierre de un
    // período en curso es una fecha futura, y contar activos a futuro daría de baja
    // a todos los que todavía no renovaron.
    const arpuActual = arpu({ monthlyRevenue: ingresos, activeMembers: activos });

    const engagement = await this.calcularEngagement({
      gymId: dto.gymId,
      historiales,
      asistencias,
      registroDesde,
      transcurrido,
      activos,
      now: dto.now,
    });

    // El embudo no depende del stream de eventos de membresía, así que sale igual
    // antes y después del corte de datos: se calcula una vez y viaja en las dos ramas.
    const embudo = this.calcularEmbudo({
      leads,
      conversiones,
      transcurrido,
      now: dto.now,
    });

    // Antes del corte no se sabe quién estaba activo: las renovaciones previas a la
    // siembra no registraron vencimiento. Todo lo que dependa de la base inicial
    // queda en null en vez de estimarse.
    const baseConfiable = corte !== null && periodo.start.getTime() >= corte.getTime();

    if (!baseConfiable) {
      return {
        periodo: { desde: periodo.start, hasta: periodo.end },
        datosCompletosDesde: corte,
        socios: {
          activos,
          enGracia,
          altasEnPeriodo: altas,
          bajasEnPeriodo: null,
          crecimientoNeto: null,
        },
        retencion: { churnMensual: null, tasaRetencion: null, cohorte90Dias: null },
        financiero: { ingresosPeriodo: ingresos, mrr: mrrActual, arpu: arpuActual, ltv: null },
        engagement,
        embudo,
      };
    }

    const membersAtStart = activeMembersAt(historiales, periodo.start);
    const membersAtEnd = activeMembersAt(historiales, hasta);
    const bajas = churnedMembersIn(historiales, transcurrido);

    const churn = monthlyChurnRate({
      membersAtStart,
      cancelledDuringPeriod: bajas,
    });

    return {
      periodo: { desde: periodo.start, hasta: periodo.end },
      datosCompletosDesde: corte,
      socios: {
        activos,
        enGracia,
        altasEnPeriodo: altas,
        bajasEnPeriodo: bajas,
        crecimientoNeto: netMemberGrowth({ newMembers: altas, churnedMembers: bajas }),
      },
      retencion: {
        churnMensual: churn,
        tasaRetencion: retentionRate({
          membersAtStart,
          membersAtEnd,
          newMembersInPeriod: altas,
        }),
        cohorte90Dias: this.calcularCohorte(historiales, corte, dto.now),
      },
      financiero: {
        ingresosPeriodo: ingresos,
        mrr: mrrActual,
        arpu: arpuActual,
        ltv:
          arpuActual !== null && churn !== null
            ? lifetimeValue({ arpu: arpuActual, monthlyChurnRate: churn })
            : null,
      },
      engagement,
      embudo,
    };
  }

  /**
   * Adquisición y embudo.
   *
   * Dos lecturas conviven acá a propósito. Los conteos (`leadsNuevos`,
   * `conversionesEnPeriodo`) son dato crudo del período y siempre tienen valor. La
   * tasa es de cohorte y viene censurada, así que en el mes en curso casi siempre
   * vale `null`: mezclar las dos cosas en un solo número daría un porcentaje que
   * mejora solo porque el mes recién empieza.
   */
  private calcularEmbudo(input: {
    leads: ReadonlyArray<LeadRecord>;
    conversiones: number;
    transcurrido: DateRange;
    now: Date;
  }): GymKpis['embudo'] {
    const { leads, conversiones, transcurrido, now } = input;

    return {
      leadsNuevos: leads.length,
      leadsPorSemana: newLeadsPerWeek({
        leadsInPeriod: leads.length,
        periodDays: diasEntre(transcurrido.start, transcurrido.end),
      }),
      conversionesEnPeriodo: conversiones,
      sinConvertir: leads.filter((l) => !l.convertido).length,
      sinContactar: leads.filter((l) => l.fechaPrimerContacto === null).length,
      tasaConversion: cohortConversionRate({
        leads,
        windowDays: VENTANA_CONVERSION_DIAS,
        now,
      }),
      ventanaConversionDias: VENTANA_CONVERSION_DIAS,
      tiempoRespuestaMinutos: avgLeadResponseMinutes(
        leads.map((l) => ({
          createdAt: l.createdAt,
          firstContactedAt: l.fechaPrimerContacto,
        }))
      ),
    };
  }

  /**
   * Frecuencia de visita y socios en riesgo.
   *
   * Va contra el registro de asistencia, que arranca cuando el gym empieza a usar la
   * función y no cuando el gym abrió. Por eso las dos métricas se acotan a la
   * ventana efectivamente registrada: si no, el día que se activa el módulo todos
   * los socios figurarían sin venir hace dos semanas, que sería un artefacto del
   * sistema y no una verdad sobre el gimnasio.
   */
  private async calcularEngagement(input: {
    gymId: string;
    historiales: ReadonlyArray<ClientMembershipHistory>;
    asistencias: ReadonlyArray<MemberLastCheckIn>;
    registroDesde: Date | null;
    transcurrido: DateRange;
    activos: number;
    now: Date;
  }): Promise<GymKpis['engagement']> {
    const { registroDesde, transcurrido, now } = input;

    if (registroDesde === null) {
      return { visitasPorSocioPorSemana: null, enRiesgo: null, registroDesde: null };
    }

    // Solo el tramo del período en el que efectivamente se registró asistencia.
    const desde = this.elMayor(transcurrido.start, registroDesde);
    const rangoConRegistro: DateRange = { start: desde, end: transcurrido.end };
    const diasConRegistro = diasEntre(desde, transcurrido.end);

    const totalCheckIns = await this.metricsRepository.countCheckIns(
      input.gymId,
      rangoConRegistro
    );

    const visitasPorSocioPorSemana = avgVisitsPerMemberPerWeek({
      totalCheckIns,
      activeMembers: input.activos,
      periodDays: diasConRegistro,
    });

    // Sin dos semanas de registro no se puede afirmar que alguien lleva dos semanas
    // sin venir.
    if (diasEntre(registroDesde, now) < DIAS_SIN_ASISTIR_PARA_RIESGO) {
      return { visitasPorSocioPorSemana, enRiesgo: null, registroDesde };
    }

    const ultimaPorSocio = new Map(
      input.asistencias.map((a) => [a.clientId, a.lastCheckInAt])
    );

    const clientIds = findAtRiskMembers({
      members: input.historiales
        .filter((h) => isActiveAt(h.windows, now))
        .map((h) => ({
          memberId: h.clientId,
          // Ausente del mapa = nunca vino: riesgo por definición.
          lastCheckInAt: ultimaPorSocio.get(h.clientId) ?? null,
        })),
      staleDays: DIAS_SIN_ASISTIR_PARA_RIESGO,
      now,
    });

    const nombrePorSocio = new Map(input.historiales.map((h) => [h.clientId, h.nombre]));

    return {
      visitasPorSocioPorSemana,
      enRiesgo: {
        total: clientIds.length,
        // `findAtRiskMembers` devuelve ids —es lo correcto para una función de
        // dominio— y el nombre se resuelve acá, que es donde está el padrón.
        socios: clientIds.map((id) => ({ id, nombre: nombrePorSocio.get(id) ?? null })),
      },
      registroDesde,
    };
  }

  private elMayor(a: Date, b: Date): Date {
    return a.getTime() >= b.getTime() ? a : b;
  }

  /**
   * Por defecto, el mes calendario en curso. Rango semiabierto [desde, hasta).
   *
   * El corte es a medianoche **UTC**, no a la hora local del proceso. Antes usaba
   * `new Date(y, m, 1)`, que corta donde esté parado el server: el mismo request
   * devolvía un período en un contenedor con `TZ=UTC` y otro corrido tres horas en
   * una máquina argentina, y un alta del día 1 a las 00:30 caía en un mes o en el
   * otro según dónde corriera. UTC es además el contrato que el front asumió.
   *
   * Esto NO vale para el día calendario del check-in ni para el mapa de calor: ahí
   * la hora es el dato y se corta en la zona del gimnasio (`domain/time/zonaHoraria`).
   */
  private resolverPeriodo(dto: GetGymKpisDTO): DateRange {
    if (dto.desde && dto.hasta) {
      if (dto.desde.getTime() >= dto.hasta.getTime()) {
        throw new ValidationError('desde must be earlier than hasta');
      }
      return { start: dto.desde, end: dto.hasta };
    }

    const inicioDeMes = new Date(Date.UTC(dto.now.getUTCFullYear(), dto.now.getUTCMonth(), 1));
    const inicioDelSiguiente = new Date(
      Date.UTC(dto.now.getUTCFullYear(), dto.now.getUTCMonth() + 1, 1)
    );

    return { start: inicioDeMes, end: inicioDelSiguiente };
  }

  private elMenor(a: Date, b: Date): Date {
    return a.getTime() <= b.getTime() ? a : b;
  }

  /**
   * Retención a 90 días, móvil: entran solo las altas posteriores al corte que ya
   * cumplieron la ventana. Las anteriores al corte quedan afuera porque no se sabe
   * si tuvieron un hueco en el medio, y las muy recientes las censura
   * `cohortRetention` con el `now`.
   */
  private calcularCohorte(
    historiales: ReadonlyArray<ClientMembershipHistory>,
    corte: Date | null,
    now: Date
  ): Rate | null {
    if (corte === null) {
      return null;
    }

    const cohorte: CohortMember[] = historiales
      .filter((h) => h.fechaAlta.getTime() >= corte.getTime())
      .map((h) => ({
        memberId: h.clientId,
        joinedAt: h.fechaAlta,
        cancelledAt: firstChurnDate(h.windows, now),
      }));

    return cohortRetention({ cohort: cohorte, windowDays: VENTANA_COHORTE_DIAS, now });
  }
}

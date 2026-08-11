import { Response, NextFunction } from 'express';
import { GetGymDashboardUseCase } from '../../../application/use-cases/dashboard/GetGymDashboardUseCase';
import {
  GetGymKpisUseCase,
  GymKpis,
} from '../../../application/use-cases/dashboard/GetGymKpisUseCase';
import {
  GetGymKpisSeriesUseCase,
  GymKpisSeriesPoint,
} from '../../../application/use-cases/dashboard/GetGymKpisSeriesUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';

/**
 * REGLA DE SERIALIZACIÓN DE FECHAS, común a todos los endpoints del dashboard.
 *
 * Hay dos clases de fecha en esta API y se serializan distinto a propósito:
 *
 *  - **Límite de período** (`periodo.desde/hasta`, `puntos[].desde/hasta`, la ventana
 *    del heatmap): es una medianoche, no tiene hora significativa. Viaja como
 *    `yyyy-MM-dd`.
 *  - **Instante** (`datosCompletosDesde`, `engagement.registroDesde`): es un momento
 *    real —cuándo se sembró, cuándo entró el primer socio— y la hora es parte del
 *    dato. Viaja como ISO completo.
 *
 * La regla existe porque antes había dos políticas conviviendo y el MISMO campo salía
 * en dos formatos según el endpoint: `datosCompletosDesde` era instante en
 * `/dashboard/kpis` y fecha en `/dashboard/kpis/series`. El front tenía que ramificar
 * por endpoint para parsear un campo con un solo significado.
 *
 * El formato vive en el borde y no en el caso de uso: el dominio razona con `Date`
 * como todo el resto del sistema.
 */
const aFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Mes calendario, `yyyy-MM`. Es la etiqueta del eje X de la gráfica. */
const aMes = (fecha: Date): string => fecha.toISOString().slice(0, 7);

/** El punto tal como viaja por HTTP: fechas ya formateadas, montos en centavos. */
interface PuntoDeSerieResponse {
  mes: string;
  desde: string;
  hasta: string;
  ingresos: number;
  mrr: number;
  altas: number;
  bajas: number | null;
  crecimientoNeto: number | null;
  /** Fracción `[0,1]`, igual que en `/dashboard/kpis`. El formato es del front. */
  churnMensual: number | null;
  tasaRetencion: number | null;
}

const aPuntoDeSerie = (punto: GymKpisSeriesPoint): PuntoDeSerieResponse => ({
  mes: aMes(punto.desde),
  desde: aFecha(punto.desde),
  hasta: aFecha(punto.hasta),
  ingresos: punto.ingresos,
  mrr: punto.mrr,
  altas: punto.altas,
  bajas: punto.bajas,
  crecimientoNeto: punto.crecimientoNeto,
  churnMensual: punto.churnMensual,
  tasaRetencion: punto.tasaRetencion,
});

/** `GymKpis` con el período recortado a fecha; el resto viaja tal cual. */
type KpisResponse = Omit<GymKpis, 'periodo'> & {
  periodo: { desde: string; hasta: string };
};

/**
 * El único campo que se reformatea es `periodo`, que es un límite.
 *
 * `datosCompletosDesde` y `engagement.registroDesde` se dejan como `Date` para que
 * `res.json` los serialice como instante ISO: son momentos reales, no límites.
 *
 * Nota sobre el eco del período: si el cliente manda `?desde=` con hora —cosa que el
 * contrato no contempla— el cálculo la respeta pero el eco la trunca. El front manda
 * fechas sin hora, que es lo que el propio pedido documenta.
 */
const aKpisResponse = (kpis: GymKpis): KpisResponse => ({
  ...kpis,
  periodo: { desde: aFecha(kpis.periodo.desde), hasta: aFecha(kpis.periodo.hasta) },
});

export class DashboardController {
  constructor(
    private getGymDashboardUseCase: GetGymDashboardUseCase,
    private getGymKpisUseCase: GetGymKpisUseCase,
    private getGymKpisSeriesUseCase: GetGymKpisSeriesUseCase
  ) {}

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      // El reloj se lee en el borde y se inyecta: los casos de uso quedan
      // determinísticos y testeables sin congelar el tiempo.
      const metrics = await this.getGymDashboardUseCase.execute(gymId, new Date());

      res.json({
        status: 'success',
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }

  async getKpis(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);
      const { desde, hasta } = req.query as { desde?: Date; hasta?: Date };

      const kpis = await this.getGymKpisUseCase.execute({
        gymId,
        now: new Date(),
        desde,
        hasta
      });

      res.json({
        status: 'success',
        data: aKpisResponse(kpis)
      });
    } catch (error) {
      next(error);
    }
  }

  async getKpisSeries(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const gymId = getTenantId(req);
      const { meses } = req.query as unknown as { meses: number };

      const serie = await this.getGymKpisSeriesUseCase.execute({
        gymId,
        now: new Date(),
        meses,
      });

      res.json({
        status: 'success',
        data: {
          // Instante ISO completo, igual que en `/dashboard/kpis`: no es un límite de
          // período sino el momento de la siembra, y la hora es parte del dato. Antes
          // se recortaba acá y el mismo campo salía en dos formatos según el endpoint.
          datosCompletosDesde: serie.datosCompletosDesde,
          puntos: serie.puntos.map(aPuntoDeSerie)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async getSummary(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // El rol ya lo garantiza `requireAdmin` en la ruta; no se re-chequea acá.

      // Placeholder - se implementaría agregación de todos los gyms
      res.json({
        status: 'success',
        data: {
          message: 'Summary endpoint - implement aggregation across all gyms'
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

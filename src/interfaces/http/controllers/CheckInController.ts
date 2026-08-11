import { Response, NextFunction } from 'express';
import { RegisterCheckInUseCase } from '../../../application/use-cases/checkin/RegisterCheckInUseCase';
import { SearchCheckInsUseCase } from '../../../application/use-cases/checkin/SearchCheckInsUseCase';
import { GetCheckInHeatmapUseCase } from '../../../application/use-cases/checkin/GetCheckInHeatmapUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';

/**
 * Fecha sin hora, `yyyy-MM-dd`. Misma regla que el dashboard (ver
 * `DashboardController`): un **límite de período** viaja como fecha, un **instante**
 * como ISO completo.
 *
 * Acá el límite se formatea EN LA ZONA DEL GIMNASIO y no recortando el ISO, porque
 * los bordes de esta ventana son medianoches locales y no UTC: la medianoche
 * argentina del 13 de junio es `2026-06-13T03:00:00Z` —recortar da el día correcto
 * por casualidad— pero la de una zona al este de Greenwich cae en el día anterior y
 * el recorte devolvería la fecha equivocada.
 *
 * Cada endpoint formatea su límite en el marco en el que lo cortó, y por eso el
 * heatmap devuelve `zonaHoraria`: es el marco de `desde` y `hasta`.
 */
const aFechaEn = (fecha: Date, zona: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);

export class CheckInController {
  constructor(
    private registerCheckInUseCase: RegisterCheckInUseCase,
    private searchCheckInsUseCase: SearchCheckInsUseCase,
    private getCheckInHeatmapUseCase: GetCheckInHeatmapUseCase
  ) {}

  async register(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);
      const { clientId, fecha } = req.body as { clientId: string; fecha?: Date };

      const checkIn = await this.registerCheckInUseCase.execute({
        gymId,
        clientId,
        // El reloj se lee en el borde y se inyecta.
        fecha: fecha ?? new Date()
      });

      res.status(201).json({
        status: 'success',
        data: checkIn
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);
      const { clientId, desde, hasta, page, limit } = req.query as unknown as {
        clientId?: string;
        desde?: Date;
        hasta?: Date;
        page: number;
        limit: number;
      };

      const result = await this.searchCheckInsUseCase.execute({
        gymId,
        filters: { clientId, desde, hasta },
        page,
        limit
      });

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async heatmap(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);
      const { semanas } = req.query as unknown as { semanas: number };

      const mapa = await this.getCheckInHeatmapUseCase.execute({
        gymId,
        now: new Date(),
        semanas
      });

      res.json({
        status: 'success',
        data: {
          zonaHoraria: mapa.zonaHoraria,
          desde: aFechaEn(mapa.desde, mapa.zonaHoraria),
          // Exclusivo, igual que el `hasta` de la serie de KPIs: es la medianoche del
          // día siguiente al último incluido. La ventana cubre exactamente
          // `semanas × 7` días del gimnasio.
          hasta: aFechaEn(mapa.hasta, mapa.zonaHoraria),
          // Instante ISO completo, NO recortado: no es un límite de ventana sino el
          // momento de la primera asistencia. Recortarlo sería peor que verboso —
          // `desde`/`hasta` están en hora del gimnasio y este instante está en UTC, así
          // que un `slice(0,10)` los pondría a comparar en marcos distintos y la banda
          // rayada arrancaría un día corrida.
          registroDesde: mapa.registroDesde,
          celdas: mapa.celdas
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

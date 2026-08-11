import { Response, NextFunction } from 'express';
import { GenerateRoutineUseCase } from '../../../application/use-cases/routine/GenerateRoutineUseCase';
import { ResendRoutineUseCase } from '../../../application/use-cases/routine/ResendRoutineUseCase';
import { SearchRoutinesUseCase } from '../../../application/use-cases/routine/SearchRoutinesUseCase';
import { IRoutineRepository } from '../../../domain/repositories/IRoutineRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import {
  RoutineGenerationStatus,
  RoutineSendStatus,
} from '../../../domain/entities/Routine';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getTenantId } from '../middlewares/tenantMiddleware';
import { IFileStorage } from '../../../domain/services/IFileStorage';
import { NotFoundError } from '../../../shared/errors/AppError';

export class RoutineController {
  constructor(
    private generateRoutineUseCase: GenerateRoutineUseCase,
    private resendRoutineUseCase: ResendRoutineUseCase,
    private routineRepository: IRoutineRepository,
    private clientRepository: IClientRepository,
    private fileStorage: IFileStorage,
    private searchRoutinesUseCase: SearchRoutinesUseCase
  ) {}

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);

      const filters = {
        clientId: req.query.clientId as string | undefined,
        estadoEnvio: req.query.estadoEnvio as RoutineSendStatus | undefined,
        estadoGeneracion: req.query.estadoGeneracion as RoutineGenerationStatus | undefined,
        vencimientoDesde: req.query.vencimientoDesde as Date | undefined,
        vencimientoHasta: req.query.vencimientoHasta as Date | undefined
      };

      const result = await this.searchRoutinesUseCase.execute({
        gymId,
        filters,
        page: req.query.page as number | undefined,
        limit: req.query.limit as number | undefined
      });

      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async generate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { clientId } = req.params;
      const gymId = getTenantId(req);

      const result = await this.generateRoutineUseCase.execute(clientId, gymId);

      // 200 OK - procesamiento sincrónico. `fuenteCredencial` viaja en la respuesta
      // para que el frontend distinga una rutina generada con el modelo que el gym
      // configuró de una que salió por el respaldo de la plataforma.
      res.status(200).json({
        status: 'success',
        message:
          result.fuenteCredencial === 'respaldo'
            ? 'Routine generated with the platform fallback AI provider'
            : 'Routine generated successfully',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const gymId = getTenantId(req);

      const routine = await this.routineRepository.findById(id, gymId);
      if (!routine) {
        throw new NotFoundError('Routine');
      }

      res.json({
        status: 'success',
        data: routine
      });
    } catch (error) {
      next(error);
    }
  }

  async getByClient(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { clientId } = req.params;
      const gymId = getTenantId(req);

      const routines = await this.routineRepository.findByClientId(clientId, gymId);

      res.json({
        status: 'success',
        data: routines
      });
    } catch (error) {
      next(error);
    }
  }

  async getExpiring(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const gymId = getTenantId(req);
      const days = parseInt(req.query.days as string) || 7;

      const count = await this.routineRepository.countExpiringByDay(gymId, days);

      res.json({
        status: 'success',
        data: {
          count,
          days
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Devuelve el PDF de la rutina como binario.
   *
   * Existe porque `routine.pdfUrl` es una ruta del filesystem del SERVIDOR
   * (`./storage/generated/...`), no una URL pública: sin este endpoint el front
   * recibía esa ruta y no podía hacer nada con ella. El archivo se lee por el
   * puerto de storage, así que el día que se mueva a S3 esto no cambia.
   *
   * La rutina se busca SIEMPRE con el tenant: pedir el PDF de otro gimnasio tiene
   * que dar 404, no servir el archivo.
   */
  async downloadPdf(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const gymId = getTenantId(req);

      const routine = await this.routineRepository.findById(id, gymId);
      if (!routine) {
        throw new NotFoundError('Routine');
      }

      if (!routine.pdfUrl) {
        // La rutina existe pero su PDF no: quedó en `error`, o todavía se está
        // generando. Es un 404 del PDF, no de la rutina.
        throw new NotFoundError('Routine PDF');
      }

      const client = await this.clientRepository.findById(routine.clientId, gymId);
      const pdfBuffer = await this.fileStorage.read(routine.pdfUrl);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', pdfBuffer.length);
      // `inline` y no `attachment`: el caso principal es previsualizarlo en el CRM.
      // El navegador igual permite descargarlo desde el visor.
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${this.nombreDeArchivo(client?.nombre)}"`
      );

      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Nombre de archivo seguro para la cabecera.
   *
   * El nombre del socio lo carga un humano y viaja dentro de un header entre
   * comillas: sin sanear, unas comillas o un salto de línea permitirían inyectar
   * cabeceras. Se deja solo lo que es seguro e imprimible.
   */
  private nombreDeArchivo(nombreCliente?: string): string {
    const base = (nombreCliente ?? 'socio')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60);

    return `rutina-${base || 'socio'}.pdf`;
  }

  async resend(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const gymId = getTenantId(req);

      const result = await this.resendRoutineUseCase.execute(id, gymId);

      res.json({
        status: 'success',
        message: 'Routine resent',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

import { AiUsageRecord } from '../entities/AiUsageRecord';
import { AiProvider } from '../entities/Gym';
import { PaginatedResult } from './IClientRepository';

/**
 * Contrato de persistencia del consumo de IA. Multi-tenant: cada método recibe
 * `gymId` explícito, porque el consumo es la base para tarifarle a cada gimnasio.
 */

export interface AiUsageSearchFilters {
  clientId?: string;
  routineId?: string;
  provider?: AiProvider;
  model?: string;
  desde?: Date;
  hasta?: Date;
}

export interface AiUsageMonthBucket {
  year: number;
  month: number;
  tokensTotal: number;
  costoEstimado: number;
  rutinas: number;
}

export interface AiUsageModelBucket {
  provider: AiProvider;
  model: string;
  tokensTotal: number;
  costoEstimado: number;
  rutinas: number;
}

export interface AiUsageReport {
  desde: Date;
  hasta: Date;
  tokensTotal: number;
  /** Suma de los costos conocidos. No incluye las rutinas sin precio cargado. */
  costoEstimado: number;
  rutinas: number;
  /**
   * Rutinas cuyo modelo no tiene precio en domain/ai/pricing. El total las
   * subestima: sin este número, un costo bajo podría ser "gastó poco" o
   * "faltan precios" y no habría manera de distinguirlo.
   */
  rutinasSinPrecio: number;
  porMes: AiUsageMonthBucket[];
  porModelo: AiUsageModelBucket[];
}

export type CreateAiUsageInput = Omit<AiUsageRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface IAiUsageRepository {
  create(record: CreateAiUsageInput): Promise<AiUsageRecord>;

  search(
    gymId: string,
    filters: AiUsageSearchFilters,
    page?: number,
    limit?: number
  ): Promise<PaginatedResult<AiUsageRecord>>;

  /** Consumo agregado de un período, con desglose por mes y por modelo. */
  getUsageByPeriod(gymId: string, desde: Date, hasta: Date): Promise<AiUsageReport>;
}

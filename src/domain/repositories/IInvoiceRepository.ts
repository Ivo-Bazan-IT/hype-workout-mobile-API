import { Invoice, InvoiceStatus } from '../entities/Invoice';
import { PaginatedResult } from './IClientRepository';

/**
 * Contrato de persistencia de facturas electrónicas (AFIP).
 *
 * Habla en términos de la entidad `Invoice` del dominio, no del documento de Mongo:
 * antes este puerto exportaba un `InvoiceDocument` con `_id`, que es una forma de
 * persistencia filtrándose hacia adentro.
 *
 * Todos los métodos reciben `gymId` explícito. La factura es dato fiscal y de dinero:
 * una consulta sin filtrar por tenant expone la facturación de otro gimnasio.
 */

export interface InvoiceSearchFilters {
  /** Socio al que se le emitió la factura */
  clientId?: string;
  estado?: InvoiceStatus;
  /** Ej: "Factura C" */
  tipoComprobante?: string;
  /** Número de CAE, para buscar un comprobante puntual */
  cae?: string;
  emitidaDesde?: Date;
  emitidaHasta?: Date;
}

export interface RevenuePeriodBucket {
  year: number;
  month: number;
  total: number;
  cantidad: number;
}

export interface RevenueReport {
  desde: Date;
  hasta: Date;
  total: number;
  cantidad: number;
  porMes: RevenuePeriodBucket[];
}

/** El alta no exige `fechaEmision`: si no se indica, se asume el momento de emisión. */
export type CreateInvoiceInput = Omit<
  Invoice,
  'id' | 'createdAt' | 'updatedAt' | 'fechaEmision'
> & { fechaEmision?: Date };

export interface IInvoiceRepository {
  create(invoice: CreateInvoiceInput): Promise<Invoice>;

  findById(id: string, gymId: string): Promise<Invoice | null>;

  /** Listado paginado del historial de facturación del gym. */
  search(
    gymId: string,
    filters: InvoiceSearchFilters,
    page?: number,
    limit?: number
  ): Promise<PaginatedResult<Invoice>>;

  update(id: string, gymId: string, data: Partial<Invoice>): Promise<Invoice | null>;

  /**
   * Suma de ingresos de un mes puntual - usado por el KPI del dashboard.
   * @param month Mes de consulta (1-12)
   */
  sumRevenueByMonth(gymId: string, year: number, month: number): Promise<number>;

  /** Ingresos de un período arbitrario, con desglose mensual para graficar. */
  getRevenueByPeriod(gymId: string, desde: Date, hasta: Date): Promise<RevenueReport>;
}

import { Invoice, InvoiceStatus } from '../entities/Invoice';
import { ResultadoEmision } from '../billing/types';
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

/**
 * El alta no exige la mayoría de los datos fiscales: una factura nace `pendiente`,
 * cuando todavía no se habló con AFIP, y recién al emitirse conoce su CAE, su número
 * y su desglose de IVA. Si no se indica `fechaEmision`, se asume el momento del alta.
 */
export type CreateInvoiceInput = Omit<
  Invoice,
  'id' | 'createdAt' | 'updatedAt' | 'fechaEmision' | 'intentos' | 'cae'
> & { fechaEmision?: Date; intentos?: number; cae?: string };

export interface IInvoiceRepository {
  create(invoice: CreateInvoiceInput): Promise<Invoice>;

  findById(id: string, gymId: string): Promise<Invoice | null>;

  /**
   * Reserva la próxima factura pendiente cuyo `proximoIntento` ya venció y la
   * devuelve, incrementando su contador de intentos y corriendo `proximoIntento`
   * hacia adelante `leaseMs` milisegundos.
   *
   * Esa reserva tiene que ser ATÓMICA: si dos ticks del worker —o dos instancias del
   * server— tomaran la misma factura, el socio recibiría dos comprobantes por la
   * misma cuota, y una factura emitida de más ante AFIP no se borra: se anula con
   * nota de crédito. El lease además hace de red de seguridad si el proceso se cae
   * en la mitad de la emisión, porque la factura vuelve a estar disponible sola
   * cuando vence.
   *
   * Es el ÚNICO método del puerto que no recibe `gymId`, y es a propósito: el worker
   * es global y atiende la cola de todos los tenants. El `gymId` viaja en la factura
   * devuelta y es el que gobierna todo lo que sigue.
   */
  claimPendiente(leaseMs: number): Promise<Invoice | null>;

  /**
   * Cierra la emisión con los datos que devolvió AFIP: pasa la factura a `emitida`,
   * guarda la terna del comprobante y el desglose de importes, y la saca de la cola.
   */
  marcarEmitida(
    id: string,
    gymId: string,
    resultado: ResultadoEmision,
    fechaEmision: Date
  ): Promise<Invoice | null>;

  /**
   * Registra un intento fallido. `estado` decide si la factura vuelve a la cola
   * (`pendiente`, con su `proximoIntento` corrido por el backoff) o si el fallo es
   * definitivo (`error`) y queda esperando un reintento manual.
   */
  marcarFallo(
    id: string,
    gymId: string,
    fallo: { estado: Extract<InvoiceStatus, 'pendiente' | 'error'>; errorLog: string; proximoIntento?: Date }
  ): Promise<Invoice | null>;

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

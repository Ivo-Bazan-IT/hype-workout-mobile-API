import { RenewalRequest, RenewalRequestStatus, CreateRenewalRequestInput } from '../entities/RenewalRequest';
import { PaginatedResult } from './IClientRepository';

/**
 * Contrato de persistencia de los pedidos de renovación por Mercado Pago.
 *
 * Todos los métodos reciben `gymId` explícito, mismo criterio que `IInvoiceRepository`:
 * es dinero y datos del socio, y una consulta sin filtrar por tenant expondría el
 * historial de cobros de otro gimnasio.
 */
export interface IRenewalRequestRepository {
  create(request: CreateRenewalRequestInput): Promise<RenewalRequest>;

  findById(id: string, gymId: string): Promise<RenewalRequest | null>;

  /**
   * El pago de Mercado Pago llega identificado por `externalReference`, no por
   * `id` propio: es el dato que ata la notificación del webhook a este pedido.
   * NO recibe `gymId` porque en ese momento todavía no se sabe con certeza a qué
   * gym pertenece — el webhook lo identifica por `mercadoPagoConfig.mpUserId`
   * antes de llegar acá, y esta búsqueda es la confirmación cruzada.
   */
  findByExternalReference(externalReference: string): Promise<RenewalRequest | null>;

  /** El pedido pendiente más reciente del cliente, si hay alguno. */
  findPendienteByClientId(clientId: string, gymId: string): Promise<RenewalRequest | null>;

  /** Historial paginado, para el badge de "renovación pendiente" y el reenvío. */
  search(
    gymId: string,
    filters: { clientId?: string; estado?: RenewalRequestStatus },
    page?: number,
    limit?: number
  ): Promise<PaginatedResult<RenewalRequest>>;

  update(id: string, gymId: string, data: Partial<RenewalRequest>): Promise<RenewalRequest | null>;
}

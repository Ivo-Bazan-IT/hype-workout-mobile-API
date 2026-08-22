import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { IInvoiceRepository } from '../../../domain/repositories/IInvoiceRepository';
import { IMembershipEventRepository } from '../../../domain/repositories/IMembershipEventRepository';
import { NotFoundError } from '../../../shared/errors/AppError';
import { Client } from '../../../domain/entities/Client';
import { ClientTaxCondition, resolverComprobante } from '../../../domain/billing/types';

interface AplicarRenovacionDTO {
  clientId: string;
  gymId: string;
  monto: number;
  nuevaFechaVencimiento: Date;
  /** Concepto de la factura. Default: "Cuota Mensual - <mes>", igual que antes. */
  descripcion?: string;
}

/**
 * El corazón de "renovar a un socio": extender el vencimiento, dejar constancia
 * en el stream de membership y encolar la factura si el gym factura.
 *
 * Extraído de lo que antes era el cuerpo entero de `RenewClientUseCase`, para que
 * los DOS caminos de cobro converjan acá y no puedan divergir con el tiempo:
 *
 *  - `client/RenewClientUseCase` — el operador confirma un cobro en efectivo o
 *    transferencia, en el momento.
 *  - `payments/ProcessMercadoPagoWebhookUseCase` — Mercado Pago confirma un pago
 *    por link, más tarde, vía webhook.
 *
 * Si esta lógica viviera duplicada en los dos, un cambio en cómo se calcula el
 * churn o en cómo se arma el comprobante podría corregirse en un lado y no en el
 * otro sin que nadie lo note.
 */
export class AplicarRenovacionUseCase {
  constructor(
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository,
    private invoiceRepository: IInvoiceRepository,
    private membershipEventRepository: IMembershipEventRepository
  ) {}

  async execute(dto: AplicarRenovacionDTO): Promise<Client> {
    const existingClient = await this.clientRepository.findById(dto.clientId, dto.gymId);

    if (!existingClient) {
      throw new NotFoundError('Client');
    }

    // Un único instante para el historial y para el evento: si cada uno llamara a
    // `new Date()` por su cuenta quedarían desfasados por milisegundos y el stream
    // dejaría de reconciliar con `historialRenovaciones`.
    const fechaRenovacion = new Date();

    const nuevaRenovacion = {
      fecha: fechaRenovacion,
      monto: dto.monto
    };

    const historialRenovaciones = [...(existingClient.historialRenovaciones || []), nuevaRenovacion];
    const esRecurrente = historialRenovaciones.length > 1;

    const clienteActualizado = await this.clientRepository.update(dto.clientId, dto.gymId, {
      fechaVencimiento: dto.nuevaFechaVencimiento,
      historialRenovaciones,
      esRecurrente,
      estado: 'activo'
    });

    // Cierra la ventana anterior y abre la nueva. Es el evento del que salen el
    // churn (si hubo hueco), el MRR (monto sobre duración) y los ingresos del
    // período: va antes de la facturación porque el KPI no depende de que AFIP
    // conteste, y de hecho la mayoría de los gyms no tiene facturación activa.
    await this.membershipEventRepository.create({
      gymId: dto.gymId,
      clientId: dto.clientId,
      tipo: 'renovacion',
      fecha: fechaRenovacion,
      monto: dto.monto,
      vencimientoAnterior: existingClient.fechaVencimiento,
      vencimientoNuevo: dto.nuevaFechaVencimiento,
      origen: 'operacion'
    });

    // Encolar la factura. Acá NO se habla con AFIP: se deja el comprobante en
    // `pendiente` y lo emite el worker por su cuenta.
    try {
      const gym = await this.gymRepository.findById(dto.gymId);

      if (gym?.afipConfig?.isActive) {
        // El comprobante sale de `resolverComprobante`, que mira DOS condiciones:
        // la del gym (decide si hay Factura C sin más vuelta) y la del socio (decide
        // entre A y B cuando el gym es Responsable Inscripto). Es solo la vista
        // "pendiente": el valor que de verdad queda en el comprobante es el que
        // devuelve AFIP al emitir, en `marcarEmitida`.
        const comprobante = resolverComprobante(
          gym.afipConfig.taxCondition,
          existingClient.condicionFiscal ?? ClientTaxCondition.CONSUMIDOR_FINAL
        );

        await this.invoiceRepository.create({
          gymId: dto.gymId,
          clientId: dto.clientId,
          tipoComprobante: comprobante.nombre,
          codigoTipoComprobante: comprobante.codigo,
          monto: dto.monto,
          descripcion:
            dto.descripcion ??
            `Cuota Mensual - ${fechaRenovacion.toLocaleDateString('es-AR', { month: 'long' })}`,
          estado: 'pendiente'
        });
      }
    } catch (error: any) {
      // Lo único que puede fallar acá es la base. La renovación ya está registrada
      // y el evento también, así que se deja constancia y se sigue: dejar al socio
      // sin renovar por un problema de facturación sería el peor de los dos males.
      console.error('❌ No se pudo encolar la factura de la renovación:', error);
    }

    return clienteActualizado!;
  }
}

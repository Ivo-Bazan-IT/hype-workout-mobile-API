import { IInvoiceRepository } from '../../../domain/repositories/IInvoiceRepository';
import { Invoice } from '../../../domain/entities/Invoice';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';

interface RetryInvoiceDTO {
  invoiceId: string;
  gymId: string;
}

/**
 * Reencola a mano una factura que quedó en `error`.
 *
 * Los fallos definitivos son casi siempre datos mal cargados —CUIT del gym con un
 * dígito de menos, punto de venta que no existe, DNI del socio incompleto—, y esos
 * no se arreglan reintentando: los arregla una persona. Este caso de uso es lo que
 * cierra el círculo después de esa corrección, sin obligar a renovar de nuevo al
 * socio para volver a generar el comprobante.
 */
export class RetryInvoiceUseCase {
  constructor(private invoiceRepository: IInvoiceRepository) {}

  async execute(dto: RetryInvoiceDTO): Promise<Invoice> {
    const factura = await this.invoiceRepository.findById(dto.invoiceId, dto.gymId);

    if (!factura) {
      throw new NotFoundError('Invoice');
    }

    // Solo desde `error`. Reencolar una `emitida` la facturaría dos veces, y una
    // `pendiente` ya está en la cola: pisarle el contador solo alargaría su vida.
    if (factura.estado !== 'error') {
      throw new ValidationError(
        `Solo se puede reintentar una factura en estado error (esta está en "${factura.estado}")`
      );
    }

    const reencolada = await this.invoiceRepository.update(dto.invoiceId, dto.gymId, {
      estado: 'pendiente',
      // Se le devuelve el crédito completo de intentos: el reintento manual llega
      // después de corregir el dato, así que es un caso nuevo, no la continuación
      // de la serie que ya se agotó.
      intentos: 0,
      proximoIntento: new Date()
    });

    return reencolada!;
  }
}

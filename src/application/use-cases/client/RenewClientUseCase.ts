import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { IInvoiceRepository } from '../../../domain/repositories/IInvoiceRepository';
import { IMembershipEventRepository } from '../../../domain/repositories/IMembershipEventRepository';
import { IInvoiceProviderFactory } from '../../../domain/services/IInvoiceProviderFactory';
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';
import { Client } from '../../../domain/entities/Client';
import { GymTaxCondition } from '../../../domain/billing/types';

interface RenewClientDTO {
  clientId: string;
  gymId: string;
  monto: number;
  nuevaFechaVencimiento: Date;
}

export class RenewClientUseCase {
  constructor(
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository,
    private gymSecretsRepo: IGymSecretsRepository,
    private invoiceRepository: IInvoiceRepository,
    private invoiceProviderFactory: IInvoiceProviderFactory,
    private membershipEventRepository: IMembershipEventRepository
  ) {}

  async execute(dto: RenewClientDTO): Promise<Client> {
    // Verificar que el cliente existe y pertenece al gym
    const existingClient = await this.clientRepository.findById(dto.clientId, dto.gymId);

    if (!existingClient) {
      throw new NotFoundError('Client');
    }

    if (dto.monto <= 0) {
      throw new ValidationError('Monto debe ser positivo');
    }

    // Un único instante para el historial y para el evento: si cada uno llamara a
    // `new Date()` por su cuenta quedarían desfasados por milisegundos y el stream
    // dejaría de reconciliar con `historialRenovaciones`.
    const fechaRenovacion = new Date();

    // Agregar al historial de renovaciones
    const nuevaRenovacion = {
      fecha: fechaRenovacion,
      monto: dto.monto
    };

    const historialRenovaciones = [...(existingClient.historialRenovaciones || []), nuevaRenovacion];
    const esRecurrente = historialRenovaciones.length > 1;

    // Actualizar el cliente
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

    // Generar factura sincrónicamente (con manejo de errores)
    try {
      const gym = await this.gymRepository.findById(dto.gymId);

      if (gym && gym.afipConfig?.isActive) {
        const afipApiKey = await this.gymSecretsRepo.getAfipApiKey(dto.gymId);

        if (afipApiKey) {
          const invoiceProvider = this.invoiceProviderFactory.create({
            tenantId: dto.gymId,
            cuit: parseInt(gym.cuit),
            puntoVenta: gym.afipConfig.puntoVenta,
            taxCondition: gym.afipConfig.taxCondition as GymTaxCondition,
            afipSdkApiKey: afipApiKey
          });

          const result = await invoiceProvider.emitInvoice({
            amount: dto.monto,
            clientDocument: parseInt(existingClient.documento),
            isConsumidorFinal: true,
            description: `Cuota Mensual - ${new Date().toLocaleDateString('es-AR', { month: 'long' })}`
          });

          // Persistir factura emitida
          await this.invoiceRepository.create({
            gymId: dto.gymId,
            clientId: dto.clientId,
            tipoComprobante: gym.afipConfig.taxCondition === 'MONOTRIBUTO' ? 'Factura C' : 'Factura B',
            cae: result.cae,
            monto: dto.monto,
            estado: 'emitida'
          });

          console.log(`✅ Invoice generated for client ${dto.clientId} - CAE: ${result.cae}`);
        }
      }
    } catch (error: any) {
      console.error('❌ Invoice generation error:', error);

      // Persistir error pero no fallar la renovación
      await this.invoiceRepository.create({
        gymId: dto.gymId,
        clientId: dto.clientId,
        tipoComprobante: 'Factura C',
        cae: '',
        monto: dto.monto,
        estado: 'error',
        errorLog: error.message
      });
    }

    return clienteActualizado!;
  }
}
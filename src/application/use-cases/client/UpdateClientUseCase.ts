import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IMembershipEventRepository } from '../../../domain/repositories/IMembershipEventRepository';
import { Client, tieneEncuestaCompleta } from '../../../domain/entities/Client';
import { NotFoundError, ConflictError, ValidationError } from '../../../shared/errors/AppError';
import { ClientTaxCondition } from '../../../domain/billing/types';
import { normalizarCuit } from '../../../domain/billing/documentos';

interface UpdateClientDTO {
  clientId: string;
  gymId: string;
  data: Partial<Omit<Client, 'id' | 'gymId' | 'createdAt' | 'updatedAt'>>;
}

export class UpdateClientUseCase {
  constructor(
    private clientRepository: IClientRepository,
    private membershipEventRepository: IMembershipEventRepository
  ) {}

  async execute(dto: UpdateClientDTO): Promise<Client> {
    // Verificar que el cliente existe
    const existingClient = await this.clientRepository.findById(dto.clientId, dto.gymId);
    if (!existingClient) {
      throw new NotFoundError('Client');
    }

    // El documento identifica al cliente dentro del gym: si cambia, hay que
    // preservar su unicidad.
    if (dto.data.documento && dto.data.documento !== existingClient.documento) {
      const clienteConEseDocumento = await this.clientRepository.findByDocumento(
        dto.data.documento,
        dto.gymId
      );
      if (clienteConEseDocumento) {
        throw new ConflictError('A client with this documento already exists');
      }
    }

    // La condición fiscal resultante puede venir de este PUT o de lo que ya tenía
    // el cliente: se valida el estado final, no solo lo que llegó en el body, para
    // no dejar pasar un PUT que solo cambia condicionFiscal sin tocar cuit.
    const condicionFiscalFinal = dto.data.condicionFiscal ?? existingClient.condicionFiscal;
    const cuitFinal = dto.data.cuit ?? existingClient.cuit;
    if (condicionFiscalFinal === ClientTaxCondition.RESPONSABLE_INSCRIPTO && normalizarCuit(cuitFinal ?? '') === null) {
      throw new ValidationError('Un cliente Responsable Inscripto necesita un CUIT válido (11 dígitos)');
    }

    // El PUT también puede traer la encuesta, así que también puede ser el momento
    // en que un lead convierte. Se sella acá para que el KPI no dependa de por cuál
    // de los tres caminos entró el dato (PUT, PATCH de encuesta o webhook del Form).
    const conviertioAhora =
      dto.data.encuestaData !== undefined &&
      !tieneEncuestaCompleta(existingClient.encuestaData) &&
      existingClient.fechaConversion === undefined &&
      tieneEncuestaCompleta(dto.data.encuestaData);

    const clienteActualizado = await this.clientRepository.update(dto.clientId, dto.gymId, {
      ...dto.data,
      ...(conviertioAhora && { fechaConversion: new Date() })
    });

    if (!clienteActualizado) {
      throw new NotFoundError('Client');
    }

    // Mover el vencimiento a mano corre la ventana de membresía igual que una
    // renovación, pero sin cobro. Se registra como `ajuste` para que la corrección
    // quede auditable: si no, el churn calculado y la realidad se separarían acá y
    // no habría forma de saber por qué.
    const vencimientoNuevo = dto.data.fechaVencimiento;
    if (
      vencimientoNuevo !== undefined &&
      vencimientoNuevo.getTime() !== existingClient.fechaVencimiento.getTime()
    ) {
      await this.membershipEventRepository.create({
        gymId: dto.gymId,
        clientId: dto.clientId,
        tipo: 'ajuste',
        fecha: new Date(),
        vencimientoAnterior: existingClient.fechaVencimiento,
        vencimientoNuevo,
        origen: 'operacion'
      });
    }

    return clienteActualizado;
  }
}
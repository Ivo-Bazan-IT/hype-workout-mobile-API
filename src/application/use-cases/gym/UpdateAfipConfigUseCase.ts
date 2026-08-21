import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { AfipConfig, Gym } from '../../../domain/entities/Gym';
import { GymTaxCondition } from '../../../domain/billing/types';
import { ConflictError, NotFoundError } from '../../../shared/errors/AppError';

interface UpdateAfipConfigDTO {
  gymId: string;
  /**
   * CUIT del gimnasio emisor. Se edita desde la pantalla de facturación porque es
   * un dato fiscal, aunque viva en la raíz del gym y no dentro de `afipConfig`:
   * es la identidad del contribuyente, no una preferencia de facturación.
   */
  cuit?: string;
  puntoVenta?: number;
  taxCondition?: GymTaxCondition;
  isActive?: boolean;
}

/**
 * Configura la identidad fiscal con la que se emiten los comprobantes del gym.
 *
 * NO hay credencial de AFIP SDK acá: esa cuenta es única y de la plataforma
 * (`AFIP_SDK_API_KEY`). Lo que el dueño del gimnasio define es quién factura
 * —CUIT, punto de venta, condición fiscal—, no con qué cuenta se llega a ARCA.
 */
export class UpdateAfipConfigUseCase {
  constructor(private gymRepository: IGymRepository) {}

  async execute(dto: UpdateAfipConfigDTO): Promise<Gym> {
    const gym = await this.gymRepository.findById(dto.gymId);

    if (!gym) {
      throw new NotFoundError('Gym');
    }

    // El CUIT es único entre gyms: dos tenants facturando con el mismo CUIT harían
    // que los comprobantes de uno aparezcan en la cuenta fiscal del otro.
    if (dto.cuit && dto.cuit !== gym.cuit) {
      const duplicado = await this.gymRepository.findByCuit(dto.cuit);
      if (duplicado) {
        throw new ConflictError('A gym with this CUIT already exists');
      }
    }

    const afipConfig: AfipConfig = gym.afipConfig ?? {
      puntoVenta: 1,
      taxCondition: GymTaxCondition.MONOTRIBUTO,
      isActive: false
    };

    // Se acumula sobre UN solo objeto: mandar varios campos en la misma llamada
    // —que es lo que hace la pantalla al configurar por primera vez— no puede
    // hacer que uno pise a otro con la versión vieja del guardado.
    const actualizado: AfipConfig = { ...afipConfig };

    if (dto.puntoVenta !== undefined) actualizado.puntoVenta = dto.puntoVenta;
    if (dto.taxCondition !== undefined) actualizado.taxCondition = dto.taxCondition;
    if (dto.isActive !== undefined) actualizado.isActive = dto.isActive;

    const updateData: Partial<Gym> = { afipConfig: actualizado };
    if (dto.cuit !== undefined) updateData.cuit = dto.cuit;

    const updatedGym = await this.gymRepository.update(dto.gymId, updateData);

    return updatedGym!;
  }
}

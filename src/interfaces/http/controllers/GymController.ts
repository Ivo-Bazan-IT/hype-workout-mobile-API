import { Request, Response, NextFunction } from 'express';
import { CreateGymUseCase } from '../../../application/use-cases/gym/CreateGymUseCase';
import { UpdateGymUseCase } from '../../../application/use-cases/gym/UpdateGymUseCase';
import { DeleteGymUseCase } from '../../../application/use-cases/gym/DeleteGymUseCase';
import { ListGymsUseCase } from '../../../application/use-cases/gym/ListGymsUseCase';
import { UpdateWhatsappConfigUseCase } from '../../../application/use-cases/gym/UpdateWhatsappConfigUseCase';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Gym } from '../../../domain/entities/Gym';
import { NotFoundError } from '../../../shared/errors/AppError';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

/**
 * Proyección del gym para el panel de super-admin.
 *
 * Allowlist explícito, igual que en `/api/gyms/settings`: las credenciales viven
 * cifradas DENTRO de `aiConfig`/`whatsappConfig`, así que devolver esos objetos
 * enteros filtraría el ciphertext. Se informa si están cargadas con un booleano,
 * que es lo único que la interfaz necesita para mostrar "configurado ✓".
 */
const toAdminGymResponse = (gym: Gym) => ({
  id: gym.id,
  name: gym.name,
  businessName: gym.businessName,
  cuit: gym.cuit,
  contactEmail: gym.contactEmail,
  contactPhone: gym.contactPhone,
  isActive: gym.isActive,
  aiConfig: {
    provider: gym.aiConfig?.provider,
    model: gym.aiConfig?.model,
    hasApiKey: Boolean(gym.aiConfig?.encryptedApiKey),
  },
  whatsappConfig: {
    phoneNumberId: gym.whatsappConfig?.phoneNumberId ?? '',
    hasAccessToken: Boolean(gym.whatsappConfig?.encryptedAccessToken),
  },
  googleFormConfig: { formId: gym.googleFormConfig?.formId },
  afipConfig: gym.afipConfig
    ? {
        puntoVenta: gym.afipConfig.puntoVenta,
        taxCondition: gym.afipConfig.taxCondition,
        isActive: gym.afipConfig.isActive,
      }
    : undefined,
  createdAt: gym.createdAt,
  updatedAt: gym.updatedAt,
});

export class GymController {
  constructor(
    private createGymUseCase: CreateGymUseCase,
    private updateGymUseCase: UpdateGymUseCase,
    private deleteGymUseCase: DeleteGymUseCase,
    private listGymsUseCase: ListGymsUseCase,
    private updateWhatsappConfigUseCase: UpdateWhatsappConfigUseCase,
    private gymRepository: IGymRepository
  ) {}

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.createGymUseCase.execute(req.body);

      res.status(201).json({
        status: 'success',
        data: {
          gym: {
            id: result.gym.id,
            name: result.gym.name,
            businessName: result.gym.businessName,
            cuit: result.gym.cuit,
          },
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const gyms = await this.listGymsUseCase.execute();

      res.json({
        status: 'success',
        data: gyms.map(gym => ({
          id: gym.id,
          name: gym.name,
          businessName: gym.businessName,
          cuit: gym.cuit,
          contactEmail: gym.contactEmail,
          contactPhone: gym.contactPhone,
          isActive: gym.isActive,
          // El dashboard de plataforma cuenta las altas del mes y ordena las
          // últimas por fecha: sin `createdAt` en la proyección esas métricas
          // daban 0 aunque el dato estuviera en la base.
          createdAt: gym.createdAt,
          updatedAt: gym.updatedAt,
        }))
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const gym = await this.gymRepository.findById(id);
      if (!gym) {
        throw new NotFoundError('Gym');
      }

      res.json({ status: 'success', data: toAdminGymResponse(gym) });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { whatsappPhoneNumberId, whatsappAccessToken, ...datosDelGym } = req.body;

      const result = await this.updateGymUseCase.execute(id, datosDelGym);

      if (!result) {
        res.status(404).json({
          status: 'error',
          message: 'Gym not found'
        });
        return;
      }

      // WhatsApp por separado: el caso de uso dedicado hace merge y cifra el token.
      // Mandarlo dentro del update genérico reemplazaría el objeto y borraría la
      // credencial que no viaja en el body.
      const gymFinal =
        whatsappPhoneNumberId !== undefined || whatsappAccessToken !== undefined
          ? await this.updateWhatsappConfigUseCase.execute({
              gymId: id,
              phoneNumberId: whatsappPhoneNumberId,
              accessToken: whatsappAccessToken,
            })
          : result;

      res.json({ status: 'success', data: toAdminGymResponse(gymFinal) });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const success = await this.deleteGymUseCase.execute(id);

      if (!success) {
        res.status(404).json({
          status: 'error',
          message: 'Gym not found'
        });
        return;
      }

      res.json({
        status: 'success',
        message: 'Gym deactivated successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}
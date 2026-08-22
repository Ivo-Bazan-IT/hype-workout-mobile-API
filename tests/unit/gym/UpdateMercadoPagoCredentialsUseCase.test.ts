import { describe, it, expect, vi } from 'vitest';
import { UpdateMercadoPagoCredentialsUseCase } from '../../../src/application/use-cases/gym/UpdateMercadoPagoCredentialsUseCase';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const gym = {
  id: 'gym-1',
  mercadoPagoConfig: undefined as Record<string, unknown> | undefined,
};

// Igual criterio que el mock de whatsapp: ofusca de verdad, para que una
// aserción de "no viaja en claro" tenga sentido.
const cipher = (plain: string) => `cipher::${Buffer.from(plain).toString('base64')}`;

const buildEncryption = () =>
  ({
    encrypt: vi.fn(cipher),
    decrypt: vi.fn((payload: string) => payload),
  }) as any;

const buildGymRepo = (stored: Record<string, any> = gym) =>
  ({
    findById: vi.fn().mockResolvedValue(stored),
    update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ ...stored, ...data })),
  }) as any;

const buildPaymentProviderFactory = (userId = 'mp-user-1') =>
  ({
    create: vi.fn().mockReturnValue({
      obtenerCuenta: vi.fn().mockResolvedValue({ userId }),
    }),
  }) as any;

describe('UpdateMercadoPagoCredentialsUseCase', () => {
  it('lanza ValidationError si no se manda ninguna credencial', async () => {
    const useCase = new UpdateMercadoPagoCredentialsUseCase(
      buildGymRepo(),
      buildPaymentProviderFactory(),
      buildEncryption()
    );

    await expect(useCase.execute({ gymId: 'gym-1' })).rejects.toThrow(ValidationError);
  });

  it('lanza NotFoundError si el gym no existe', async () => {
    const gymRepo = { findById: vi.fn().mockResolvedValue(null), update: vi.fn() } as any;
    const useCase = new UpdateMercadoPagoCredentialsUseCase(
      gymRepo,
      buildPaymentProviderFactory(),
      buildEncryption()
    );

    await expect(
      useCase.execute({ gymId: 'missing', accessToken: 'APP_USR-token' })
    ).rejects.toThrow(NotFoundError);
  });

  it('valida el accessToken contra Mercado Pago y captura el mpUserId automáticamente', async () => {
    const gymRepo = buildGymRepo();
    const paymentProviderFactory = buildPaymentProviderFactory('mp-user-99');
    const encryption = buildEncryption();

    const useCase = new UpdateMercadoPagoCredentialsUseCase(gymRepo, paymentProviderFactory, encryption);

    await useCase.execute({ gymId: 'gym-1', accessToken: 'APP_USR-token-real' });

    expect(paymentProviderFactory.create).toHaveBeenCalledWith({ accessToken: 'APP_USR-token-real' });
    const [, data] = gymRepo.update.mock.calls[0];
    expect(data.mercadoPagoConfig.mpUserId).toBe('mp-user-99');
    expect(data.mercadoPagoConfig.encryptedAccessToken).toBe(cipher('APP_USR-token-real'));
    // El token en claro no se persiste en ningún campo
    expect(JSON.stringify(data)).not.toContain('APP_USR-token-real');
  });

  it('propaga el error si el accessToken no es válido, sin guardar nada', async () => {
    const gymRepo = buildGymRepo();
    const paymentProviderFactory = {
      create: vi.fn().mockReturnValue({
        obtenerCuenta: vi.fn().mockRejectedValue(new Error('MERCADOPAGO_ERROR (401): invalid token')),
      }),
    } as any;

    const useCase = new UpdateMercadoPagoCredentialsUseCase(
      gymRepo,
      paymentProviderFactory,
      buildEncryption()
    );

    await expect(
      useCase.execute({ gymId: 'gym-1', accessToken: 'token-invalido' })
    ).rejects.toThrow('invalid token');

    expect(gymRepo.update).not.toHaveBeenCalled();
  });

  it('rota solo el webhookSecret sin volver a validar el accessToken', async () => {
    const gymRepo = buildGymRepo({
      ...gym,
      mercadoPagoConfig: { encryptedAccessToken: 'enc(viejo)', mpUserId: 'mp-user-1' },
    });
    const paymentProviderFactory = buildPaymentProviderFactory();
    const encryption = buildEncryption();

    const useCase = new UpdateMercadoPagoCredentialsUseCase(gymRepo, paymentProviderFactory, encryption);

    await useCase.execute({ gymId: 'gym-1', webhookSecret: 'un-secreto-de-mas-de-16' });

    expect(paymentProviderFactory.create).not.toHaveBeenCalled();
    const [, data] = gymRepo.update.mock.calls[0];
    // La credencial vieja se conserva: es un merge, no un reemplazo.
    expect(data.mercadoPagoConfig.encryptedAccessToken).toBe('enc(viejo)');
    expect(data.mercadoPagoConfig.mpUserId).toBe('mp-user-1');
    expect(data.mercadoPagoConfig.encryptedWebhookSecret).toBe(cipher('un-secreto-de-mas-de-16'));
  });
});

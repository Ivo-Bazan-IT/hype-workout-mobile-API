import { describe, it, expect, vi } from 'vitest';
import { RotateGoogleFormSecretUseCase } from '../../../src/application/use-cases/gym/RotateGoogleFormSecretUseCase';

const gym = {
  id: 'gym-1',
  googleFormConfig: {
    formId: '1FAIpQLSform-id',
  },
};

const SECRETO = 'gfw_secreto-generado';

// El mock hashea de verdad (base64): si devolviera `hash(<plano>)` el resultado
// contendría el secreto y la aserción de "no se guarda en claro" sería inútil.
const hashDe = (plain: string) => `bcrypt::${Buffer.from(plain).toString('base64')}`;

const buildSecretService = () =>
  ({
    generar: vi.fn(() => SECRETO),
    hash: vi.fn(async (secret: string) => hashDe(secret)),
    verificar: vi.fn(),
  }) as any;

const buildRepo = (stored: Record<string, any> = gym) =>
  ({
    findById: vi.fn().mockResolvedValue(stored),
    update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ ...stored, ...data })),
  }) as any;

describe('RotateGoogleFormSecretUseCase', () => {
  it('persiste el hash y nunca el secreto en claro', async () => {
    const mockGymRepo = buildRepo();
    const secretService = buildSecretService();

    const useCase = new RotateGoogleFormSecretUseCase(mockGymRepo, secretService);

    await useCase.execute({ gymId: 'gym-1' });

    const [, data] = mockGymRepo.update.mock.calls[0];
    expect(data.googleFormConfig.webhookSecretHash).toBe(hashDe(SECRETO));
    // El secreto en claro no se persiste en ningún campo
    expect(JSON.stringify(data)).not.toContain(SECRETO);
  });

  it('devuelve el secreto en claro para mostrarlo una única vez', async () => {
    const useCase = new RotateGoogleFormSecretUseCase(buildRepo(), buildSecretService());

    const { secret } = await useCase.execute({ gymId: 'gym-1' });

    expect(secret).toBe(SECRETO);
  });

  it('conserva el formId al hacer merge', async () => {
    const mockGymRepo = buildRepo();

    const useCase = new RotateGoogleFormSecretUseCase(mockGymRepo, buildSecretService());

    await useCase.execute({ gymId: 'gym-1' });

    const [, data] = mockGymRepo.update.mock.calls[0];
    expect(data.googleFormConfig.formId).toBe('1FAIpQLSform-id');
  });

  it('sella la fecha de rotación', async () => {
    const mockGymRepo = buildRepo();

    const useCase = new RotateGoogleFormSecretUseCase(mockGymRepo, buildSecretService());

    await useCase.execute({ gymId: 'gym-1' });

    const [, data] = mockGymRepo.update.mock.calls[0];
    expect(data.googleFormConfig.webhookSecretUpdatedAt).toBeInstanceOf(Date);
  });

  it('reemplaza el hash anterior: rotar invalida el secreto viejo', async () => {
    const mockGymRepo = buildRepo({
      ...gym,
      googleFormConfig: { ...gym.googleFormConfig, webhookSecretHash: 'bcrypt::anterior' },
    });

    const useCase = new RotateGoogleFormSecretUseCase(mockGymRepo, buildSecretService());

    await useCase.execute({ gymId: 'gym-1' });

    const [, data] = mockGymRepo.update.mock.calls[0];
    expect(data.googleFormConfig.webhookSecretHash).not.toBe('bcrypt::anterior');
  });

  it('lanza NotFoundError si el gym no existe', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    } as any;

    const useCase = new RotateGoogleFormSecretUseCase(mockGymRepo, buildSecretService());

    await expect(useCase.execute({ gymId: 'missing' })).rejects.toThrow('Gym not found');

    expect(mockGymRepo.update).not.toHaveBeenCalled();
  });
});

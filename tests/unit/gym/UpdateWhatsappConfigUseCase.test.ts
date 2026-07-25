import { describe, it, expect, vi } from 'vitest';
import { UpdateWhatsappConfigUseCase } from '../../../src/application/use-cases/gym/UpdateWhatsappConfigUseCase';

const gym = {
  id: 'gym-1',
  whatsappConfig: {
    phoneNumberId: 'phone-viejo',
    tokenSecretRef: 'whatsapp-30712345678',
  },
};

// El mock ofusca de verdad (base64): si devolviera `enc(<plano>)` el ciphertext
// contendría el texto plano y la aserción de "no se guarda en claro" sería inútil.
const cipher = (plain: string) => `cipher::${Buffer.from(plain).toString('base64')}`;

const buildEncryption = () =>
  ({
    encrypt: vi.fn(cipher),
    decrypt: vi.fn((payload: string) => payload),
  }) as any;

const buildRepo = (stored: Record<string, any> = gym) =>
  ({
    findById: vi.fn().mockResolvedValue(stored),
    update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ ...stored, ...data })),
  }) as any;

describe('UpdateWhatsappConfigUseCase', () => {
  it('cifra el access token del gym antes de persistirlo', async () => {
    const mockGymRepo = buildRepo();
    const encryption = buildEncryption();

    const useCase = new UpdateWhatsappConfigUseCase(mockGymRepo, encryption);

    await useCase.execute({
      gymId: 'gym-1',
      phoneNumberId: 'phone-nuevo',
      accessToken: 'EAAG-token-del-gym',
    });

    expect(encryption.encrypt).toHaveBeenCalledWith('EAAG-token-del-gym');

    const [, data] = mockGymRepo.update.mock.calls[0];
    expect(data.whatsappConfig.phoneNumberId).toBe('phone-nuevo');
    expect(data.whatsappConfig.encryptedAccessToken).toBe(cipher('EAAG-token-del-gym'));
    // El token en claro no se persiste en ningún campo
    expect(JSON.stringify(data)).not.toContain('EAAG-token-del-gym');
  });

  it('conserva el tokenSecretRef al hacer merge', async () => {
    const mockGymRepo = buildRepo();

    const useCase = new UpdateWhatsappConfigUseCase(mockGymRepo, buildEncryption());

    await useCase.execute({ gymId: 'gym-1', phoneNumberId: 'phone-nuevo' });

    const [, data] = mockGymRepo.update.mock.calls[0];
    expect(data.whatsappConfig.tokenSecretRef).toBe('whatsapp-30712345678');
  });

  it('permite cambiar solo el número sin tocar el token guardado', async () => {
    const mockGymRepo = buildRepo({
      ...gym,
      whatsappConfig: { ...gym.whatsappConfig, encryptedAccessToken: 'enc(anterior)' },
    });
    const encryption = buildEncryption();

    const useCase = new UpdateWhatsappConfigUseCase(mockGymRepo, encryption);

    await useCase.execute({ gymId: 'gym-1', phoneNumberId: 'phone-nuevo' });

    expect(encryption.encrypt).not.toHaveBeenCalled();
    const [, data] = mockGymRepo.update.mock.calls[0];
    expect(data.whatsappConfig.encryptedAccessToken).toBe('enc(anterior)');
  });

  it('lanza NotFoundError si el gym no existe', async () => {
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    } as any;

    const useCase = new UpdateWhatsappConfigUseCase(mockGymRepo, buildEncryption());

    await expect(
      useCase.execute({ gymId: 'missing', accessToken: 'tok' })
    ).rejects.toThrow('Gym not found');

    expect(mockGymRepo.update).not.toHaveBeenCalled();
  });
});

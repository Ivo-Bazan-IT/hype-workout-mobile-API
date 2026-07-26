import { describe, it, expect, vi } from 'vitest';
import { ResendRoutineUseCase } from '../../../src/application/use-cases/routine/ResendRoutineUseCase';

const buildMocks = (overrides: Record<string, any> = {}) => {
  const sendPdfDocument = vi.fn().mockResolvedValue({ messageId: 'wamid-nuevo' });

  return {
    sendPdfDocument,
    routineRepository: {
      findById: vi.fn().mockResolvedValue({
        id: 'routine-1',
        gymId: 'gym-1',
        clientId: 'client-1',
        pdfUrl: 'storage/generated/routine-1.pdf',
        estadoGeneracion: 'generado',
        estadoEnvio: 'error',
        ...overrides.routine,
      }),
      update: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
    } as any,
    clientRepository: {
      findById: vi.fn().mockResolvedValue({
        id: 'client-1',
        nombre: 'Iván Bazán',
        telefono: '5491122334455',
        ...overrides.client,
      }),
    } as any,
    gymRepository: {
      findById: vi.fn().mockResolvedValue({
        id: 'gym-1',
        whatsappConfig: { phoneNumberId: 'phone-1' },
        ...overrides.gym,
      }),
    } as any,
    gymSecretsRepo: {
      getWhatsappAccessToken: vi.fn().mockResolvedValue('gym-1-token'),
    } as any,
    whatsappProviderFactory: { create: vi.fn().mockReturnValue({ sendPdfDocument }) } as any,
    fileStorage: { read: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) } as any,
  };
};

const buildUseCase = (m: ReturnType<typeof buildMocks>) =>
  new ResendRoutineUseCase(
    m.routineRepository,
    m.clientRepository,
    m.gymRepository,
    m.gymSecretsRepo,
    m.whatsappProviderFactory,
    m.fileStorage
  );

describe('ResendRoutineUseCase', () => {
  it('reenvía el PDF ya generado sin volver a llamar a la IA', async () => {
    const mocks = buildMocks();
    const useCase = buildUseCase(mocks);

    const result = await useCase.execute('routine-1', 'gym-1');

    // Reutiliza el PDF del storage: regenerar costaría otra llamada al modelo
    expect(mocks.fileStorage.read).toHaveBeenCalledWith('storage/generated/routine-1.pdf');
    expect(mocks.sendPdfDocument).toHaveBeenCalledWith(
      expect.objectContaining({ to: '5491122334455' })
    );
    expect(result.whatsappMessageId).toBe('wamid-nuevo');
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'enviado'
    );
  });

  it('busca la rutina con el tenant, para no reenviar la de otro gym', async () => {
    const mocks = buildMocks();
    await buildUseCase(mocks).execute('routine-1', 'gym-1');

    expect(mocks.routineRepository.findById).toHaveBeenCalledWith('routine-1', 'gym-1');
  });

  it('deja la rutina reintentable si el envío falla', async () => {
    const mocks = buildMocks();
    mocks.sendPdfDocument.mockRejectedValue(new Error('Meta devolvió 400'));
    const useCase = buildUseCase(mocks);

    await expect(useCase.execute('routine-1', 'gym-1')).rejects.toThrow('WhatsApp rejected');

    // 'error' y no 'enviando': no queda colgada, se puede volver a intentar
    expect(mocks.routineRepository.updateStatus).toHaveBeenLastCalledWith(
      'routine-1',
      'gym-1',
      'generado',
      'error'
    );
  });

  it('marca 502 y no 500 cuando el fallo es de WhatsApp', async () => {
    const mocks = buildMocks();
    mocks.sendPdfDocument.mockRejectedValue(new Error('upstream'));

    await buildUseCase(mocks)
      .execute('routine-1', 'gym-1')
      .catch((error) => {
        // El backend no tiene un bug: falló el de afuera
        expect(error.statusCode).toBe(502);
      });
  });

  it('rechaza con 400 accionable si la rutina no tiene PDF', async () => {
    const mocks = buildMocks({ routine: { pdfUrl: undefined } });

    // Sin PDF hay que regenerar, no reenviar
    await expect(buildUseCase(mocks).execute('routine-1', 'gym-1')).rejects.toThrow(
      'Generate it again'
    );
    expect(mocks.sendPdfDocument).not.toHaveBeenCalled();
  });

  it('rechaza con 400 accionable si el socio no tiene teléfono', async () => {
    const mocks = buildMocks({ client: { telefono: undefined } });

    await expect(buildUseCase(mocks).execute('routine-1', 'gym-1')).rejects.toThrow(
      'no phone number'
    );
  });

  it('rechaza con 400 accionable si el gym no configuró su número', async () => {
    const mocks = buildMocks({ gym: { whatsappConfig: { phoneNumberId: '' } } });

    await expect(buildUseCase(mocks).execute('routine-1', 'gym-1')).rejects.toThrow(
      'no WhatsApp phone number'
    );
  });

  it('rechaza con 400 accionable si no hay token de WhatsApp', async () => {
    const mocks = buildMocks();
    mocks.gymSecretsRepo.getWhatsappAccessToken.mockResolvedValue(null);

    await expect(buildUseCase(mocks).execute('routine-1', 'gym-1')).rejects.toThrow(
      'no WhatsApp access token'
    );
  });

  it('devuelve 404 si la rutina no existe o es de otro gym', async () => {
    const mocks = buildMocks();
    mocks.routineRepository.findById.mockResolvedValue(null);

    await expect(buildUseCase(mocks).execute('routine-1', 'gym-1')).rejects.toThrow(
      'Routine not found'
    );
  });
});

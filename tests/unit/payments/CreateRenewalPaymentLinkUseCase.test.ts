import { describe, it, expect, vi } from 'vitest';
import { CreateRenewalPaymentLinkUseCase } from '../../../src/application/use-cases/payments/CreateRenewalPaymentLinkUseCase';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const gymConectado = (planes: Record<string, unknown>[] = []) => ({
  id: 'gym-123',
  whatsappConfig: { phoneNumberId: '111' },
  mercadoPagoConfig: { mpUserId: 'mp-user-1' },
  membershipPlans: planes,
});

const socio = (extra: Record<string, unknown> = {}) => ({
  id: 'client-1',
  gymId: 'gym-123',
  nombre: 'Juan Pérez',
  telefono: '5491122334455',
  fechaVencimiento: new Date('2026-09-01T00:00:00.000Z'),
  ...extra,
});

function makeDeps() {
  const clientRepository = { findById: vi.fn().mockResolvedValue(socio()) } as any;
  const gymRepository = {
    findById: vi.fn().mockResolvedValue(gymConectado([{ tipo: 'mensual', duracionDias: 30, monto: 10000, activo: true }])),
  } as any;
  const gymSecretsRepo = { getWhatsappAccessToken: vi.fn().mockResolvedValue('wa-token') } as any;
  const renewalRequestRepository = {
    findPendienteByClientId: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async (input: any) => ({ id: 'renewal-1', ...input })),
    update: vi.fn().mockImplementation(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
  } as any;
  const paymentProvider = {
    crearLinkPago: vi.fn().mockResolvedValue({ paymentLinkId: 'link-1', initPoint: 'https://mp.example/pay/link-1' }),
  };
  const paymentProviderFactory = { create: vi.fn().mockReturnValue(paymentProvider) } as any;
  const whatsappProvider = { sendTextMessage: vi.fn().mockResolvedValue({ messageId: 'wamid-1' }) };
  const whatsappProviderFactory = { create: vi.fn().mockReturnValue(whatsappProvider) } as any;
  const resolverAccessToken = { execute: vi.fn().mockResolvedValue('mp-access-token') } as any;

  return {
    clientRepository,
    gymRepository,
    gymSecretsRepo,
    renewalRequestRepository,
    paymentProvider,
    paymentProviderFactory,
    whatsappProvider,
    whatsappProviderFactory,
    resolverAccessToken,
  };
}

function build() {
  const deps = makeDeps();
  const useCase = new CreateRenewalPaymentLinkUseCase(
    deps.clientRepository,
    deps.gymRepository,
    deps.gymSecretsRepo,
    deps.renewalRequestRepository,
    deps.paymentProviderFactory,
    deps.whatsappProviderFactory,
    deps.resolverAccessToken
  );
  return { useCase, deps };
}

describe('CreateRenewalPaymentLinkUseCase', () => {
  it('lanza NotFoundError si el cliente no existe', async () => {
    const { useCase, deps } = build();
    deps.clientRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute({ clientId: 'client-1', gymId: 'gym-123', tipoPlan: 'mensual' })
    ).rejects.toThrow(NotFoundError);
  });

  it('lanza ValidationError si el gym no conectó Mercado Pago', async () => {
    const { useCase, deps } = build();
    deps.gymRepository.findById.mockResolvedValue({ ...gymConectado(), mercadoPagoConfig: undefined });

    await expect(
      useCase.execute({ clientId: 'client-1', gymId: 'gym-123', tipoPlan: 'mensual' })
    ).rejects.toThrow(ValidationError);
  });

  it('lanza ValidationError si el plan no existe o está inactivo', async () => {
    const { useCase, deps } = build();
    deps.gymRepository.findById.mockResolvedValue(
      gymConectado([{ tipo: 'mensual', duracionDias: 30, monto: 10000, activo: false }])
    );

    await expect(
      useCase.execute({ clientId: 'client-1', gymId: 'gym-123', tipoPlan: 'mensual' })
    ).rejects.toThrow(ValidationError);
  });

  it('crea el pedido, pide el link con el monto del plan y lo manda por WhatsApp', async () => {
    const { useCase, deps } = build();

    const resultado = await useCase.execute({ clientId: 'client-1', gymId: 'gym-123', tipoPlan: 'mensual' });

    expect(deps.paymentProvider.crearLinkPago).toHaveBeenCalledWith(
      expect.objectContaining({ monto: 10000 })
    );
    expect(deps.whatsappProvider.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: '5491122334455' })
    );
    expect(resultado.initPoint).toBe('https://mp.example/pay/link-1');
  });

  it('cancela cualquier pedido pendiente anterior antes de crear uno nuevo', async () => {
    const { useCase, deps } = build();
    deps.renewalRequestRepository.findPendienteByClientId.mockResolvedValue({ id: 'renewal-viejo' });

    await useCase.execute({ clientId: 'client-1', gymId: 'gym-123', tipoPlan: 'mensual' });

    expect(deps.renewalRequestRepository.update).toHaveBeenCalledWith(
      'renewal-viejo',
      'gym-123',
      expect.objectContaining({ estado: 'cancelado' })
    );
  });

  it('el link ya es válido aunque falle el envío por WhatsApp', async () => {
    const { useCase, deps } = build();
    deps.whatsappProvider.sendTextMessage.mockRejectedValue(new Error('Meta caído'));

    const resultado = await useCase.execute({ clientId: 'client-1', gymId: 'gym-123', tipoPlan: 'mensual' });

    expect(resultado.initPoint).toBe('https://mp.example/pay/link-1');
  });

  it('no manda WhatsApp si el socio no tiene teléfono cargado', async () => {
    const { useCase, deps } = build();
    deps.clientRepository.findById.mockResolvedValue(socio({ telefono: undefined }));

    await useCase.execute({ clientId: 'client-1', gymId: 'gym-123', tipoPlan: 'mensual' });

    expect(deps.whatsappProvider.sendTextMessage).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ProcessMercadoPagoWebhookUseCase } from '../../../src/application/use-cases/payments/ProcessMercadoPagoWebhookUseCase';

function makeDeps() {
  const gymRepository = {
    findByMercadoPagoUserId: vi.fn().mockResolvedValue({ id: 'gym-123' }),
  } as any;

  const renewalRequestRepository = {
    findByExternalReference: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  } as any;

  const paymentProvider = {
    obtenerPago: vi.fn(),
  };
  const paymentProviderFactory = {
    create: vi.fn().mockReturnValue(paymentProvider),
  } as any;

  const resolverAccessToken = {
    execute: vi.fn().mockResolvedValue('access-token-vigente'),
  } as any;

  const aplicarRenovacion = {
    execute: vi.fn().mockResolvedValue({}),
  } as any;

  return {
    gymRepository,
    renewalRequestRepository,
    paymentProvider,
    paymentProviderFactory,
    resolverAccessToken,
    aplicarRenovacion,
  };
}

function build() {
  const deps = makeDeps();
  const useCase = new ProcessMercadoPagoWebhookUseCase(
    deps.gymRepository,
    deps.renewalRequestRepository,
    deps.paymentProviderFactory,
    deps.resolverAccessToken,
    deps.aplicarRenovacion
  );
  return { useCase, deps };
}

const renewalRequestPendiente = (extra: Record<string, unknown> = {}) => ({
  id: 'renewal-1',
  gymId: 'gym-123',
  clientId: 'client-1',
  plan: { tipo: 'mensual', duracionDias: 30, monto: 10000 },
  estado: 'pendiente',
  fechaVencimientoNueva: new Date('2026-09-20T00:00:00.000Z'),
  ...extra,
});

describe('ProcessMercadoPagoWebhookUseCase', () => {
  it('ignora notificaciones que no son de tipo payment', async () => {
    const { useCase, deps } = build();

    const resultado = await useCase.execute({ type: 'merchant_order', dataId: '1', userId: '999' });

    expect(resultado.procesado).toBe(false);
    expect(deps.gymRepository.findByMercadoPagoUserId).not.toHaveBeenCalled();
  });

  it('no procesa si ningún gym está conectado con ese user_id', async () => {
    const { useCase, deps } = build();
    deps.gymRepository.findByMercadoPagoUserId.mockResolvedValue(null);

    const resultado = await useCase.execute({ type: 'payment', dataId: '1', userId: '999' });

    expect(resultado.procesado).toBe(false);
    expect(deps.paymentProviderFactory.create).not.toHaveBeenCalled();
  });

  it('nunca confía en el body del webhook: siempre vuelve a pedir el pago a la API', async () => {
    const { useCase, deps } = build();
    deps.paymentProvider.obtenerPago.mockResolvedValue({
      id: 'pago-1',
      status: 'approved',
      externalReference: 'ref-1',
      transactionAmount: 10000,
    });
    deps.renewalRequestRepository.findByExternalReference.mockResolvedValue(renewalRequestPendiente());

    await useCase.execute({ type: 'payment', dataId: 'pago-1', userId: '999' });

    expect(deps.paymentProvider.obtenerPago).toHaveBeenCalledWith('pago-1');
  });

  it('aplica la renovación cuando el pago está aprobado', async () => {
    const { useCase, deps } = build();
    deps.paymentProvider.obtenerPago.mockResolvedValue({
      id: 'pago-1',
      status: 'approved',
      externalReference: 'ref-1',
      transactionAmount: 10000,
    });
    const renewalRequest = renewalRequestPendiente();
    deps.renewalRequestRepository.findByExternalReference.mockResolvedValue(renewalRequest);

    const resultado = await useCase.execute({ type: 'payment', dataId: 'pago-1', userId: '999' });

    expect(resultado.procesado).toBe(true);
    expect(deps.aplicarRenovacion.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        gymId: 'gym-123',
        monto: 10000,
        nuevaFechaVencimiento: renewalRequest.fechaVencimientoNueva,
      })
    );
    expect(deps.renewalRequestRepository.update).toHaveBeenCalledWith(
      'renewal-1',
      'gym-123',
      expect.objectContaining({ estado: 'aprobado', mercadoPagoPaymentId: 'pago-1' })
    );
  });

  it('marca rechazado sin aplicar renovación cuando el pago se rechaza', async () => {
    const { useCase, deps } = build();
    deps.paymentProvider.obtenerPago.mockResolvedValue({
      id: 'pago-1',
      status: 'rejected',
      externalReference: 'ref-1',
      transactionAmount: 10000,
    });
    deps.renewalRequestRepository.findByExternalReference.mockResolvedValue(renewalRequestPendiente());

    const resultado = await useCase.execute({ type: 'payment', dataId: 'pago-1', userId: '999' });

    expect(resultado.procesado).toBe(true);
    expect(deps.aplicarRenovacion.execute).not.toHaveBeenCalled();
    expect(deps.renewalRequestRepository.update).toHaveBeenCalledWith(
      'renewal-1',
      'gym-123',
      expect.objectContaining({ estado: 'rechazado' })
    );
  });

  it('no hace nada con un estado no definitivo (pending)', async () => {
    const { useCase, deps } = build();
    deps.paymentProvider.obtenerPago.mockResolvedValue({
      id: 'pago-1',
      status: 'pending',
      externalReference: 'ref-1',
      transactionAmount: 10000,
    });
    deps.renewalRequestRepository.findByExternalReference.mockResolvedValue(renewalRequestPendiente());

    const resultado = await useCase.execute({ type: 'payment', dataId: 'pago-1', userId: '999' });

    expect(resultado.procesado).toBe(false);
    expect(deps.aplicarRenovacion.execute).not.toHaveBeenCalled();
    expect(deps.renewalRequestRepository.update).not.toHaveBeenCalled();
  });

  it('es idempotente: un pedido que ya no está pendiente no se vuelve a aplicar', async () => {
    const { useCase, deps } = build();
    deps.paymentProvider.obtenerPago.mockResolvedValue({
      id: 'pago-1',
      status: 'approved',
      externalReference: 'ref-1',
      transactionAmount: 10000,
    });
    deps.renewalRequestRepository.findByExternalReference.mockResolvedValue(
      renewalRequestPendiente({ estado: 'aprobado' })
    );

    const resultado = await useCase.execute({ type: 'payment', dataId: 'pago-1', userId: '999' });

    expect(resultado.procesado).toBe(false);
    expect(deps.aplicarRenovacion.execute).not.toHaveBeenCalled();
  });

  it('no procesa un pedido que pertenece a otro gym', async () => {
    const { useCase, deps } = build();
    deps.paymentProvider.obtenerPago.mockResolvedValue({
      id: 'pago-1',
      status: 'approved',
      externalReference: 'ref-1',
      transactionAmount: 10000,
    });
    deps.renewalRequestRepository.findByExternalReference.mockResolvedValue(
      renewalRequestPendiente({ gymId: 'otro-gym' })
    );

    const resultado = await useCase.execute({ type: 'payment', dataId: 'pago-1', userId: '999' });

    expect(resultado.procesado).toBe(false);
    expect(deps.aplicarRenovacion.execute).not.toHaveBeenCalled();
  });
});

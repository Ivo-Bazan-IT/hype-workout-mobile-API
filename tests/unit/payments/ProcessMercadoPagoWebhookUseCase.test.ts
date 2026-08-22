import { describe, it, expect, vi } from 'vitest';
import { ProcessMercadoPagoWebhookUseCase } from '../../../src/application/use-cases/payments/ProcessMercadoPagoWebhookUseCase';

function makeDeps() {
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

  const aplicarRenovacion = {
    execute: vi.fn().mockResolvedValue({}),
  } as any;

  return {
    renewalRequestRepository,
    paymentProvider,
    paymentProviderFactory,
    aplicarRenovacion,
  };
}

function build() {
  const deps = makeDeps();
  const useCase = new ProcessMercadoPagoWebhookUseCase(
    deps.renewalRequestRepository,
    deps.paymentProviderFactory,
    deps.aplicarRenovacion
  );
  return { useCase, deps };
}

/**
 * Desde el 22/08/2026 el gym y el accessToken ya vienen resueltos por la ruta
 * (encontrar el gym por user_id y verificar la firma con su secreto son
 * responsabilidades de borde). El caso de uso ya no busca al gym: por eso los
 * tests que antes probaban "no procesa si ningún gym está conectado" se
 * movieron a nivel ruta/e2e.
 */
const dto = (extra: Record<string, unknown> = {}) => ({
  type: 'payment',
  dataId: '1',
  gymId: 'gym-123',
  accessToken: 'access-token-vigente',
  ...extra,
});

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

    const resultado = await useCase.execute(dto({ type: 'merchant_order' }));

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

    await useCase.execute(dto({ dataId: 'pago-1' }));

    expect(deps.paymentProvider.obtenerPago).toHaveBeenCalledWith('pago-1');
    expect(deps.paymentProviderFactory.create).toHaveBeenCalledWith({
      accessToken: 'access-token-vigente',
    });
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

    const resultado = await useCase.execute(dto({ dataId: 'pago-1' }));

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

    const resultado = await useCase.execute(dto({ dataId: 'pago-1' }));

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

    const resultado = await useCase.execute(dto({ dataId: 'pago-1' }));

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

    const resultado = await useCase.execute(dto({ dataId: 'pago-1' }));

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

    const resultado = await useCase.execute(dto({ dataId: 'pago-1' }));

    expect(resultado.procesado).toBe(false);
    expect(deps.aplicarRenovacion.execute).not.toHaveBeenCalled();
  });
});

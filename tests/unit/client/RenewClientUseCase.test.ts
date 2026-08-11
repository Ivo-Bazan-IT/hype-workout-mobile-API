import { describe, it, expect, vi } from 'vitest';
import { RenewClientUseCase } from '../../../src/application/use-cases/client/RenewClientUseCase';
import { ValidationError, NotFoundError } from '../../../src/shared/errors/AppError';

// Mock invoiceQueue before importing the use case
vi.mock('../../../src/infrastructure/queues/routineQueue', () => ({
  invoiceQueue: {
    add: vi.fn().mockResolvedValue({}),
  },
}));

// Construye el juego completo de dependencias que el caso de uso espera.
// gymRepository devuelve por defecto un gym sin afipConfig activo, de modo que
// la rama de facturación AFIP se saltea y el test se enfoca en la renovación.
function makeDeps(clientRepoOverrides: Record<string, unknown> = {}) {
  const clientRepository = {
    findById: vi.fn(),
    update: vi.fn(),
    ...clientRepoOverrides,
  } as any;
  const gymRepository = {
    findById: vi.fn().mockResolvedValue({ id: 'gym-123', afipConfig: undefined }),
  } as any;
  const gymSecretsRepo = {
    getAfipApiKey: vi.fn().mockResolvedValue(null),
  } as any;
  const invoiceRepository = {
    create: vi.fn().mockResolvedValue({}),
  } as any;
  // Fábrica de facturación: por defecto el gym no tiene AFIP activo, así que no se invoca.
  const invoiceProviderFactory = {
    create: vi.fn().mockReturnValue({
      emitInvoice: vi.fn().mockResolvedValue({ cae: 'CAE-TEST' }),
    }),
  } as any;
  const membershipEventRepository = {
    create: vi.fn().mockResolvedValue({}),
  } as any;
  return {
    clientRepository,
    gymRepository,
    gymSecretsRepo,
    invoiceRepository,
    invoiceProviderFactory,
    membershipEventRepository,
  };
}

function build(clientRepoOverrides: Record<string, unknown> = {}) {
  const deps = makeDeps(clientRepoOverrides);
  const useCase = new RenewClientUseCase(
    deps.clientRepository,
    deps.gymRepository,
    deps.gymSecretsRepo,
    deps.invoiceRepository,
    deps.invoiceProviderFactory,
    deps.membershipEventRepository
  );
  return { useCase, deps };
}

function makeUseCase(clientRepoOverrides: Record<string, unknown> = {}) {
  return build(clientRepoOverrides).useCase;
}

describe('RenewClientUseCase', () => {
  it('should throw NotFoundError if client does not exist', async () => {
    const useCase = makeUseCase({ findById: vi.fn().mockResolvedValue(null) });

    await expect(
      useCase.execute({
        clientId: 'client-123',
        gymId: 'gym-123',
        monto: 1000,
        nuevaFechaVencimiento: new Date(),
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw ValidationError if monto is not positive', async () => {
    const useCase = makeUseCase({
      findById: vi.fn().mockResolvedValue({
        id: 'client-123',
        gymId: 'gym-123',
        historialRenovaciones: [],
        estado: 'activo',
        documento: '12345678',
      }),
    });

    await expect(
      useCase.execute({
        clientId: 'client-123',
        gymId: 'gym-123',
        monto: -100,
        nuevaFechaVencimiento: new Date(),
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should NOT mark client as recurrente after first renewal', async () => {
    const useCase = makeUseCase({
      findById: vi.fn().mockResolvedValue({
        id: 'client-123',
        gymId: 'gym-123',
        historialRenovaciones: [],
        estado: 'activo',
        documento: '12345678',
      }),
      update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
    });

    const result = await useCase.execute({
      clientId: 'client-123',
      gymId: 'gym-123',
      monto: 1000,
      nuevaFechaVencimiento: new Date(),
    });

    expect(result.esRecurrente).toBe(false);
  });

  it('should mark client as recurrente after second renewal', async () => {
    const useCase = makeUseCase({
      findById: vi.fn().mockResolvedValue({
        id: 'client-123',
        gymId: 'gym-123',
        historialRenovaciones: [{ fecha: new Date(), monto: 500 }],
        estado: 'activo',
        documento: '12345678',
      }),
      update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
    });

    const result = await useCase.execute({
      clientId: 'client-123',
      gymId: 'gym-123',
      monto: 1000,
      nuevaFechaVencimiento: new Date(),
    });

    expect(result.esRecurrente).toBe(true);
  });

  it('registra el evento de renovación con la ventana que cierra y la que abre', async () => {
    const vencimientoAnterior = new Date('2026-03-01T00:00:00.000Z');
    const nuevaFechaVencimiento = new Date('2026-04-01T00:00:00.000Z');

    const { useCase, deps } = build({
      findById: vi.fn().mockResolvedValue({
        id: 'client-123',
        gymId: 'gym-123',
        historialRenovaciones: [],
        estado: 'activo',
        documento: '12345678',
        fechaVencimiento: vencimientoAnterior,
      }),
      update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
    });

    await useCase.execute({
      clientId: 'client-123',
      gymId: 'gym-123',
      monto: 1000,
      nuevaFechaVencimiento,
    });

    expect(deps.membershipEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        gymId: 'gym-123',
        clientId: 'client-123',
        tipo: 'renovacion',
        monto: 1000,
        vencimientoAnterior,
        vencimientoNuevo: nuevaFechaVencimiento,
        origen: 'operacion',
      })
    );
  });

  it('usa el mismo instante para el historial y para el evento', async () => {
    const { useCase, deps } = build({
      findById: vi.fn().mockResolvedValue({
        id: 'client-123',
        gymId: 'gym-123',
        historialRenovaciones: [],
        estado: 'activo',
        documento: '12345678',
        fechaVencimiento: new Date('2026-03-01T00:00:00.000Z'),
      }),
      update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
    });

    const result = await useCase.execute({
      clientId: 'client-123',
      gymId: 'gym-123',
      monto: 1000,
      nuevaFechaVencimiento: new Date('2026-04-01T00:00:00.000Z'),
    });

    const fechaDelHistorial = result.historialRenovaciones[0].fecha;
    const fechaDelEvento = deps.membershipEventRepository.create.mock.calls[0][0].fecha;

    // Si cada uno llamara a `new Date()` por su cuenta, el stream y el historial
    // quedarían desfasados y dejarían de reconciliar.
    expect(fechaDelEvento).toBe(fechaDelHistorial);
  });
});

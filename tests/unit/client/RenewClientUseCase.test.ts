import { describe, it, expect, vi } from 'vitest';
import { RenewClientUseCase } from '../../../src/application/use-cases/client/RenewClientUseCase';
import { GymTaxCondition } from '../../../src/domain/billing/types';
import { ValidationError, NotFoundError } from '../../../src/shared/errors/AppError';

// Construye el juego completo de dependencias que el caso de uso espera.
// gymRepository devuelve por defecto un gym sin afipConfig activo, de modo que
// la rama de facturación AFIP se saltea y el test se enfoca en la renovación.
function makeDeps(
  clientRepoOverrides: Record<string, unknown> = {},
  gym: Record<string, unknown> = { id: 'gym-123', afipConfig: undefined }
) {
  const clientRepository = {
    findById: vi.fn(),
    update: vi.fn(),
    ...clientRepoOverrides,
  } as any;
  const gymRepository = {
    findById: vi.fn().mockResolvedValue(gym),
  } as any;
  const invoiceRepository = {
    create: vi.fn().mockResolvedValue({}),
  } as any;
  const membershipEventRepository = {
    create: vi.fn().mockResolvedValue({}),
  } as any;
  return {
    clientRepository,
    gymRepository,
    invoiceRepository,
    membershipEventRepository,
  };
}

function build(
  clientRepoOverrides: Record<string, unknown> = {},
  gym?: Record<string, unknown>
) {
  const deps = makeDeps(clientRepoOverrides, gym);
  const useCase = new RenewClientUseCase(
    deps.clientRepository,
    deps.gymRepository,
    deps.invoiceRepository,
    deps.membershipEventRepository
  );
  return { useCase, deps };
}

/** Socio de referencia, ya renovado alguna vez o no según el historial. */
const socio = (extra: Record<string, unknown> = {}) => ({
  id: 'client-123',
  gymId: 'gym-123',
  historialRenovaciones: [],
  estado: 'activo',
  documento: '12345678',
  ...extra,
});

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

  describe('facturación', () => {
    const gymConAfip = (taxCondition: GymTaxCondition) => ({
      id: 'gym-123',
      cuit: '20-12345678-9',
      afipConfig: { isActive: true, puntoVenta: 3, taxCondition },
    });

    const renovar = (useCase: RenewClientUseCase) =>
      useCase.execute({
        clientId: 'client-123',
        gymId: 'gym-123',
        monto: 15000,
        nuevaFechaVencimiento: new Date('2026-04-01T00:00:00.000Z'),
      });

    it('no encola ninguna factura si el gym no tiene AFIP activo', async () => {
      const { useCase, deps } = build({
        findById: vi.fn().mockResolvedValue(socio()),
        update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
      });

      await renovar(useCase);

      expect(deps.invoiceRepository.create).not.toHaveBeenCalled();
    });

    it('deja la factura en pendiente, sin esperar a AFIP', async () => {
      const { useCase, deps } = build(
        {
          findById: vi.fn().mockResolvedValue(socio()),
          update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
        },
        gymConAfip(GymTaxCondition.MONOTRIBUTO)
      );

      await renovar(useCase);

      expect(deps.invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          gymId: 'gym-123',
          clientId: 'client-123',
          monto: 15000,
          estado: 'pendiente',
        })
      );
    });

    it('un gym monotributista encola una Factura C', async () => {
      const { useCase, deps } = build(
        {
          findById: vi.fn().mockResolvedValue(socio()),
          update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
        },
        gymConAfip(GymTaxCondition.MONOTRIBUTO)
      );

      await renovar(useCase);

      expect(deps.invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ tipoComprobante: 'Factura C', codigoTipoComprobante: 11 })
      );
    });

    it('un gym responsable inscripto encola una Factura B, nunca una A', async () => {
      const { useCase, deps } = build(
        {
          findById: vi.fn().mockResolvedValue(socio()),
          update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
        },
        gymConAfip(GymTaxCondition.RESPONSABLE_INSCRIPTO)
      );

      await renovar(useCase);

      expect(deps.invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ tipoComprobante: 'Factura B', codigoTipoComprobante: 6 })
      );
    });

    it('si falla el encolado, la renovación igual queda hecha', async () => {
      const { useCase, deps } = build(
        {
          findById: vi.fn().mockResolvedValue(socio()),
          update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
        },
        gymConAfip(GymTaxCondition.MONOTRIBUTO)
      );
      deps.invoiceRepository.create.mockRejectedValue(new Error('mongo caído'));

      const result = await renovar(useCase);

      expect(result.estado).toBe('activo');
      expect(result.fechaVencimiento).toEqual(new Date('2026-04-01T00:00:00.000Z'));
    });
  });
});

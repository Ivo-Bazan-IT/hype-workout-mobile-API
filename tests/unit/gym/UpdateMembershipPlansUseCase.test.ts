import { describe, it, expect, vi } from 'vitest';
import { UpdateMembershipPlansUseCase } from '../../../src/application/use-cases/gym/UpdateMembershipPlansUseCase';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

function build(gym: Record<string, unknown> | null = { id: 'gym-123' }) {
  const gymRepository = {
    findById: vi.fn().mockResolvedValue(gym),
    update: vi.fn().mockImplementation(async (id: string, data: any) => ({ id, ...data })),
  } as any;
  return { useCase: new UpdateMembershipPlansUseCase(gymRepository), gymRepository };
}

describe('UpdateMembershipPlansUseCase', () => {
  it('lanza NotFoundError si el gym no existe', async () => {
    const { useCase } = build(null);

    await expect(
      useCase.execute({ gymId: 'gym-123', planes: [] })
    ).rejects.toThrow(NotFoundError);
  });

  it('rechaza dos planes con el mismo tipo', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({
        gymId: 'gym-123',
        planes: [
          { tipo: 'mensual', duracionDias: 30, monto: 10000, activo: true },
          { tipo: 'mensual', duracionDias: 30, monto: 12000, activo: true },
        ],
      })
    ).rejects.toThrow(ValidationError);
  });

  it('rechaza un monto no positivo', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({
        gymId: 'gym-123',
        planes: [{ tipo: 'mensual', duracionDias: 30, monto: 0, activo: true }],
      })
    ).rejects.toThrow(ValidationError);
  });

  it('reemplaza el catálogo completo', async () => {
    const { useCase, gymRepository } = build();
    const planes = [
      { tipo: 'mensual', duracionDias: 30, monto: 10000, activo: true },
      { tipo: 'semestral', duracionDias: 180, monto: 50000, activo: true },
    ];

    await useCase.execute({ gymId: 'gym-123', planes });

    expect(gymRepository.update).toHaveBeenCalledWith('gym-123', { membershipPlans: planes });
  });
});

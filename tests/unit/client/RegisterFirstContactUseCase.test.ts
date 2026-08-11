import { describe, it, expect, vi } from 'vitest';
import { RegisterFirstContactUseCase } from '../../../src/application/use-cases/client/RegisterFirstContactUseCase';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const ALTA = new Date('2026-03-01T10:00:00.000Z');

function makeUseCase(cliente: Record<string, unknown> | null) {
  const clientRepository = {
    findById: vi.fn().mockResolvedValue(cliente),
    update: vi.fn().mockImplementation(async (_id, _gymId, data) => ({
      ...cliente,
      ...data,
    })),
  } as any;

  return { useCase: new RegisterFirstContactUseCase(clientRepository), clientRepository };
}

const lead = (extra: Record<string, unknown> = {}) => ({
  id: 'client-1',
  gymId: 'gym-1',
  nombre: 'Lucía Lead',
  createdAt: ALTA,
  fechaPrimerContacto: undefined,
  ...extra,
});

describe('RegisterFirstContactUseCase', () => {
  it('sella el primer contacto con el momento del request si no se pasa fecha', async () => {
    const { useCase, clientRepository } = makeUseCase(lead());

    const antes = Date.now();
    const resultado = await useCase.execute({ clientId: 'client-1', gymId: 'gym-1' });
    const despues = Date.now();

    const [, , data] = clientRepository.update.mock.calls[0];
    expect(data.fechaPrimerContacto.getTime()).toBeGreaterThanOrEqual(antes);
    expect(data.fechaPrimerContacto.getTime()).toBeLessThanOrEqual(despues);
    expect(resultado.fechaPrimerContacto).toBeDefined();
  });

  it('acepta una fecha retroactiva: el contacto real suele cargarse después', async () => {
    const contacto = new Date('2026-03-01T10:45:00.000Z');
    const { useCase, clientRepository } = makeUseCase(lead());

    await useCase.execute({ clientId: 'client-1', gymId: 'gym-1', fecha: contacto });

    expect(clientRepository.update).toHaveBeenCalledWith('client-1', 'gym-1', {
      fechaPrimerContacto: contacto,
    });
  });

  it('es idempotente: repetirlo no corre la fecha original', async () => {
    const original = new Date('2026-03-01T10:15:00.000Z');
    const { useCase, clientRepository } = makeUseCase(
      lead({ fechaPrimerContacto: original })
    );

    const resultado = await useCase.execute({
      clientId: 'client-1',
      gymId: 'gym-1',
      fecha: new Date('2026-03-08T10:00:00.000Z'),
    });

    // El KPI mide el PRIMER contacto: si el último ganara, mediría otra cosa.
    expect(resultado.fechaPrimerContacto).toBe(original);
    expect(clientRepository.update).not.toHaveBeenCalled();
  });

  it('rechaza un contacto futuro, que daría un tiempo de respuesta negativo', async () => {
    const { useCase } = makeUseCase(lead());

    await expect(
      useCase.execute({
        clientId: 'client-1',
        gymId: 'gym-1',
        fecha: new Date(Date.now() + 60 * 60 * 1000),
      })
    ).rejects.toThrow(ValidationError);
  });

  it('rechaza un contacto anterior al alta: mediría contra un lead inexistente', async () => {
    const { useCase } = makeUseCase(lead());

    await expect(
      useCase.execute({
        clientId: 'client-1',
        gymId: 'gym-1',
        fecha: new Date('2026-02-28T10:00:00.000Z'),
      })
    ).rejects.toThrow(ValidationError);
  });

  it('no encuentra clientes de otro gym', async () => {
    const { useCase, clientRepository } = makeUseCase(null);

    await expect(
      useCase.execute({ clientId: 'client-1', gymId: 'gym-ajeno' })
    ).rejects.toThrow(NotFoundError);

    expect(clientRepository.findById).toHaveBeenCalledWith('client-1', 'gym-ajeno');
  });
});

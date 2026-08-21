import { describe, it, expect, vi } from 'vitest';
import { RetryInvoiceUseCase } from '../../../src/application/use-cases/invoice/RetryInvoiceUseCase';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const factura = (estado: string, extra: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  gymId: 'gym-1',
  clientId: 'client-1',
  tipoComprobante: 'Factura C',
  cae: '',
  monto: 15000,
  fechaEmision: new Date(),
  estado,
  intentos: 5,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

function build(facturaGuardada: any) {
  const invoiceRepository = {
    findById: vi.fn().mockResolvedValue(facturaGuardada),
    update: vi.fn(async (id: string, gymId: string, data: any) => ({ id, gymId, ...data })),
  } as any;

  return { useCase: new RetryInvoiceUseCase(invoiceRepository), invoiceRepository };
}

describe('RetryInvoiceUseCase', () => {
  it('devuelve a la cola una factura en error, con los intentos reseteados', async () => {
    const { useCase, invoiceRepository } = build(factura('error', { errorLog: 'CUIT inválido' }));

    const result = await useCase.execute({ invoiceId: 'inv-1', gymId: 'gym-1' });

    expect(invoiceRepository.update).toHaveBeenCalledWith(
      'inv-1',
      'gym-1',
      expect.objectContaining({ estado: 'pendiente', intentos: 0 })
    );
    expect(result.estado).toBe('pendiente');
  });

  it('busca la factura dentro del gym que la pide', async () => {
    const { useCase, invoiceRepository } = build(factura('error'));

    await useCase.execute({ invoiceId: 'inv-1', gymId: 'gym-1' });

    // Sin el gymId, un gym podría reencolar —y hacer emitir— el comprobante de otro.
    expect(invoiceRepository.findById).toHaveBeenCalledWith('inv-1', 'gym-1');
  });

  it('lanza NotFoundError si la factura no es de ese gym', async () => {
    const { useCase } = build(null);

    await expect(useCase.execute({ invoiceId: 'inv-1', gymId: 'gym-1' })).rejects.toThrow(
      NotFoundError
    );
  });

  it('no reintenta una factura ya emitida', async () => {
    const { useCase, invoiceRepository } = build(factura('emitida', { cae: '75123456789012' }));

    await expect(useCase.execute({ invoiceId: 'inv-1', gymId: 'gym-1' })).rejects.toThrow(
      ValidationError
    );
    // Lo importante no es el error sino que no se toque: reencolarla la facturaría dos veces.
    expect(invoiceRepository.update).not.toHaveBeenCalled();
  });

  it('no reintenta una factura que ya está en la cola', async () => {
    const { useCase } = build(factura('pendiente'));

    await expect(useCase.execute({ invoiceId: 'inv-1', gymId: 'gym-1' })).rejects.toThrow(
      ValidationError
    );
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ProcessFormSubmissionUseCase } from '../../../src/application/use-cases/onboarding/ProcessFormSubmissionUseCase';

const respuestas = {
  'Nombre completo': 'Iván Bazán',
  'DNI': '40123456',
  'Teléfono': '5491122334455',
  'Email': 'ivan@example.com',
  '¿Cuál es tu objetivo?': ['Ganar masa muscular'],
};

describe('ProcessFormSubmissionUseCase', () => {
  it('crea el cliente con las respuestas de la encuesta adjuntas', async () => {
    const mockClientRepo = {
      findByDocumento: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((client) => Promise.resolve({ id: 'client-1', ...client })),
      update: vi.fn(),
    } as any;
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'gym-1', isActive: true }),
    } as any;

    const useCase = new ProcessFormSubmissionUseCase(mockClientRepo, mockGymRepo);

    const result = await useCase.execute({ gymId: 'gym-1', respuestas });

    expect(mockClientRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        gymId: 'gym-1',
        nombre: 'Iván Bazán',
        documento: '40123456',
        estado: 'pendiente',
        encuestaData: respuestas,
      })
    );
    expect(result.encuestaData).toEqual(respuestas);
  });

  it('fusiona las respuestas nuevas sobre las previas cuando el cliente ya existe', async () => {
    const existingClient = {
      id: 'client-1',
      gymId: 'gym-1',
      documento: '40123456',
      encuestaData: {
        '¿Cuál es tu objetivo?': ['Bajar de peso'],
        '¿Tenés alguna lesión?': 'Ninguna',
      },
    };

    const mockClientRepo = {
      findByDocumento: vi.fn().mockResolvedValue(existingClient),
      create: vi.fn(),
      update: vi.fn().mockImplementation((_id, _gymId, data) =>
        Promise.resolve({ ...existingClient, ...data })
      ),
    } as any;
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'gym-1', isActive: true }),
    } as any;

    const useCase = new ProcessFormSubmissionUseCase(mockClientRepo, mockGymRepo);

    await useCase.execute({ gymId: 'gym-1', respuestas });

    expect(mockClientRepo.create).not.toHaveBeenCalled();
    expect(mockClientRepo.update).toHaveBeenCalledWith(
      'client-1',
      'gym-1',
      expect.objectContaining({
        encuestaData: {
          // Se conserva lo que la nueva submission no trae...
          '¿Tenés alguna lesión?': 'Ninguna',
          // ...y se pisa lo que sí trae
          '¿Cuál es tu objetivo?': ['Ganar masa muscular'],
          'Nombre completo': 'Iván Bazán',
          'DNI': '40123456',
          'Teléfono': '5491122334455',
          'Email': 'ivan@example.com',
        },
      })
    );
  });

  it('refresca los datos de contacto con la última submission', async () => {
    const mockClientRepo = {
      findByDocumento: vi.fn().mockResolvedValue({ id: 'client-1', gymId: 'gym-1' }),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 'client-1' }),
    } as any;
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'gym-1', isActive: true }),
    } as any;

    const useCase = new ProcessFormSubmissionUseCase(mockClientRepo, mockGymRepo);

    await useCase.execute({
      gymId: 'gym-1',
      respuestas: { ...respuestas, 'Teléfono': '5491199887766' },
    });

    expect(mockClientRepo.update).toHaveBeenCalledWith(
      'client-1',
      'gym-1',
      expect.objectContaining({ telefono: '5491199887766' })
    );
  });

  it('rechaza la submission si el gym está inactivo', async () => {
    const mockClientRepo = { findByDocumento: vi.fn(), create: vi.fn(), update: vi.fn() } as any;
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'gym-1', isActive: false }),
    } as any;

    const useCase = new ProcessFormSubmissionUseCase(mockClientRepo, mockGymRepo);

    await expect(useCase.execute({ gymId: 'gym-1', respuestas })).rejects.toThrow(
      'Invalid or inactive gym'
    );
    expect(mockClientRepo.create).not.toHaveBeenCalled();
  });

  it('rechaza la submission si faltan campos obligatorios', async () => {
    const mockClientRepo = { findByDocumento: vi.fn(), create: vi.fn(), update: vi.fn() } as any;
    const mockGymRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'gym-1', isActive: true }),
    } as any;

    const useCase = new ProcessFormSubmissionUseCase(mockClientRepo, mockGymRepo);

    await expect(
      useCase.execute({ gymId: 'gym-1', respuestas: { 'Nombre completo': 'Iván' } })
    ).rejects.toThrow('Missing required fields in form submission');
  });
});

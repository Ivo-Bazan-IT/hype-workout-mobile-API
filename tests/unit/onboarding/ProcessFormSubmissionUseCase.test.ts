import { describe, it, expect, vi } from 'vitest';
import { ProcessFormSubmissionUseCase } from '../../../src/application/use-cases/onboarding/ProcessFormSubmissionUseCase';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

/** Las siete preguntas del formulario "Proceso de Inscripción". */
const respuestas = {
  'Nombre completo': 'Iván Bazán',
  'DNI': '40123456',
  'Numero de telefono': '5491122334455',
  'Edad': '30',
  'Objetivos con el entrenamiento': 'Ganar masa muscular',
  'Lesiones en curso': 'Ninguna',
  'Cantidad de dias a la semana que podra entrenar': '3 dias',
};

const socio = (extra: Record<string, unknown> = {}) => ({
  id: 'client-1',
  gymId: 'gym-1',
  documento: '40123456',
  ...extra,
});

function makeUseCase(input: {
  cliente?: Record<string, unknown> | null;
  gym?: Record<string, unknown> | null;
  yaRecibida?: Record<string, unknown> | null;
} = {}) {
  const cliente = input.cliente === undefined ? socio() : input.cliente;

  const clientRepository = {
    findByDocumento: vi.fn().mockResolvedValue(cliente),
    findById: vi.fn().mockResolvedValue(cliente),
    create: vi.fn(),
    update: vi
      .fn()
      .mockImplementation((_id, _gymId, data) => Promise.resolve({ ...cliente, ...data })),
  } as any;

  const gymRepository = {
    findById: vi
      .fn()
      .mockResolvedValue(
        input.gym === undefined ? { id: 'gym-1', isActive: true } : input.gym
      ),
  } as any;

  const submissionRecordRepository = {
    findByResponseId: vi.fn().mockResolvedValue(input.yaRecibida ?? null),
    registrar: vi.fn().mockResolvedValue({}),
  } as any;

  return {
    useCase: new ProcessFormSubmissionUseCase(
      clientRepository,
      gymRepository,
      submissionRecordRepository
    ),
    clientRepository,
    gymRepository,
    submissionRecordRepository,
  };
}

describe('ProcessFormSubmissionUseCase', () => {
  it('vuelca la encuesta sobre el socio que ya existe, buscándolo por documento', async () => {
    const { useCase, clientRepository } = makeUseCase();

    const result = await useCase.execute({ gymId: 'gym-1', respuestas });

    expect(clientRepository.findByDocumento).toHaveBeenCalledWith('40123456', 'gym-1');
    expect(result.encuestaData).toEqual(respuestas);
  });

  it('NO crea clientes: un DNI que no existe es un 404', async () => {
    const { useCase, clientRepository } = makeUseCase({ cliente: null });

    // El onboarding es secuencial: alta → pago → encuesta. Un documento que no está
    // es un tipeo, no un socio nuevo.
    await expect(useCase.execute({ gymId: 'gym-1', respuestas })).rejects.toThrow(
      NotFoundError
    );
    expect(clientRepository.create).not.toHaveBeenCalled();
  });

  it('nombra el documento que no matcheó, para poder corregirlo', async () => {
    const { useCase } = makeUseCase({ cliente: null });

    await expect(useCase.execute({ gymId: 'gym-1', respuestas })).rejects.toThrow(
      '40123456'
    );
  });

  it('asienta el rechazo cuando el documento no existe', async () => {
    const { useCase, submissionRecordRepository } = makeUseCase({ cliente: null });

    await expect(useCase.execute({ gymId: 'gym-1', respuestas })).rejects.toThrow();

    // Sin este registro el problema solo vive en los logs de Apps Script, que quien
    // administra el gimnasio no mira.
    expect(submissionRecordRepository.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        gymId: 'gym-1',
        documento: '40123456',
        resultado: 'rechazada',
      })
    );
  });

  it('fusiona las respuestas nuevas sobre las previas', async () => {
    const { useCase, clientRepository } = makeUseCase({
      cliente: socio({
        encuestaData: {
          'Objetivos con el entrenamiento': 'Bajar de peso',
          'Lesiones en curso': 'Rodilla',
        },
      }),
    });

    await useCase.execute({
      gymId: 'gym-1',
      respuestas: { DNI: '40123456', 'Objetivos con el entrenamiento': 'Ganar masa muscular' },
    });

    const [, , data] = clientRepository.update.mock.calls[0];
    expect(data.encuestaData).toEqual({
      // Se conserva lo que la submission nueva no trae...
      'Lesiones en curso': 'Rodilla',
      // ...y se pisa lo que sí trae.
      'Objetivos con el entrenamiento': 'Ganar masa muscular',
      DNI: '40123456',
    });
  });

  it('refresca los datos de contacto con la última submission', async () => {
    const { useCase, clientRepository } = makeUseCase();

    await useCase.execute({
      gymId: 'gym-1',
      respuestas: { ...respuestas, 'Numero de telefono': '5491199887766' },
    });

    expect(clientRepository.update).toHaveBeenCalledWith(
      'client-1',
      'gym-1',
      expect.objectContaining({ telefono: '5491199887766' })
    );
  });

  it('no borra el teléfono cargado si el formulario no lo pregunta', async () => {
    const { useCase, clientRepository } = makeUseCase();

    await useCase.execute({
      gymId: 'gym-1',
      respuestas: { DNI: '40123456', 'Lesiones en curso': 'Ninguna' },
    });

    const [, , data] = clientRepository.update.mock.calls[0];
    expect(data).not.toHaveProperty('telefono');
    expect(data).not.toHaveProperty('nombre');
  });

  it('sella la conversión del lead que contesta por primera vez', async () => {
    const { useCase, clientRepository } = makeUseCase();

    await useCase.execute({ gymId: 'gym-1', respuestas });

    const [, , data] = clientRepository.update.mock.calls[0];
    expect(data.fechaConversion).toBeInstanceOf(Date);
  });

  it('no corre la conversión de quien ya había contestado', async () => {
    const { useCase, clientRepository } = makeUseCase({
      cliente: socio({
        encuestaData: { 'Lesiones en curso': 'Ninguna' },
        fechaConversion: new Date('2026-01-10T00:00:00.000Z'),
      }),
    });

    await useCase.execute({ gymId: 'gym-1', respuestas });

    const [, , data] = clientRepository.update.mock.calls[0];
    expect(data.fechaConversion).toBeUndefined();
  });

  describe('validaciones del gym', () => {
    it('rechaza la submission si el gym está inactivo', async () => {
      const { useCase, clientRepository } = makeUseCase({
        gym: { id: 'gym-1', isActive: false },
      });

      await expect(useCase.execute({ gymId: 'gym-1', respuestas })).rejects.toThrow(
        'Gym is inactive'
      );
      expect(clientRepository.update).not.toHaveBeenCalled();
    });

    it('rechaza la submission si el gym no existe', async () => {
      const { useCase, clientRepository } = makeUseCase({ gym: null });

      await expect(useCase.execute({ gymId: 'missing', respuestas })).rejects.toThrow(
        'Gym not found'
      );
      expect(clientRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('documento', () => {
    it('rechaza la submission que no trae documento', async () => {
      const { useCase } = makeUseCase();

      await expect(
        useCase.execute({ gymId: 'gym-1', respuestas: { 'Nombre completo': 'Iván' } })
      ).rejects.toThrow(ValidationError);
    });

    it('acepta la submission que SOLO trae documento y encuesta', async () => {
      const { useCase, clientRepository } = makeUseCase();

      // Un formulario que no pregunta nombre ni teléfono es legítimo: esos datos ya
      // están en la ficha, cargados en el alta.
      await useCase.execute({
        gymId: 'gym-1',
        respuestas: { DNI: '40123456', 'Lesiones en curso': 'Ninguna' },
      });

      expect(clientRepository.update).toHaveBeenCalled();
    });
  });

  it('usa el mapeo de campos que configuró el gym', async () => {
    const { useCase, clientRepository } = makeUseCase({
      gym: {
        id: 'gym-1',
        isActive: true,
        googleFormConfig: {
          fieldMapping: { nombre: '¿Cómo querés que te llamemos?' },
        },
      },
    });

    await useCase.execute({
      gymId: 'gym-1',
      respuestas: {
        // Sin mapeo, la heurística elegiría esta por empezar con "nombre"
        'Nombre del acompañante': 'Otra persona',
        '¿Cómo querés que te llamemos?': 'Iván',
        DNI: '40123456',
      },
    });

    expect(clientRepository.update).toHaveBeenCalledWith(
      'client-1',
      'gym-1',
      expect.objectContaining({ nombre: 'Iván' })
    );
  });

  describe('idempotencia por responseId', () => {
    it('no reaplica una submission ya procesada', async () => {
      const { useCase, clientRepository } = makeUseCase({
        yaRecibida: { resultado: 'procesada', clientId: 'client-1' },
      });

      const result = await useCase.execute({
        gymId: 'gym-1',
        respuestas,
        responseId: 'resp-abc',
      });

      expect(result.id).toBe('client-1');
      expect(clientRepository.update).not.toHaveBeenCalled();
    });

    it('reprocesa una submission que había sido rechazada', async () => {
      // Es la vía de recuperación: el socio se dio de alta después del rechazo y la
      // respuesta se reenvía con el mismo responseId de siempre.
      const { useCase, clientRepository } = makeUseCase({
        yaRecibida: { resultado: 'rechazada', motivo: 'not found' },
      });

      await useCase.execute({ gymId: 'gym-1', respuestas, responseId: 'resp-abc' });

      expect(clientRepository.update).toHaveBeenCalled();
    });

    it('reprocesa si el socio de la submission previa fue borrado', async () => {
      const { useCase, clientRepository, submissionRecordRepository } = makeUseCase({
        yaRecibida: { resultado: 'procesada', clientId: 'client-borrado' },
      });
      // El registro apunta a una ficha que ya no está.
      clientRepository.findById.mockResolvedValue(null);

      await useCase.execute({ gymId: 'gym-1', respuestas, responseId: 'resp-abc' });

      expect(submissionRecordRepository.findByResponseId).toHaveBeenCalledWith(
        'gym-1',
        'resp-abc'
      );
      expect(clientRepository.update).toHaveBeenCalled();
    });

    it('procesa normalmente cuando la submission no trae responseId', async () => {
      const { useCase, clientRepository, submissionRecordRepository } = makeUseCase();

      await useCase.execute({ gymId: 'gym-1', respuestas });

      // Ni siquiera se consulta: sin id no hay con qué deduplicar.
      expect(submissionRecordRepository.findByResponseId).not.toHaveBeenCalled();
      expect(clientRepository.update).toHaveBeenCalled();
    });

    it('asienta la submission procesada con su responseId', async () => {
      const { useCase, submissionRecordRepository } = makeUseCase();

      await useCase.execute({ gymId: 'gym-1', respuestas, responseId: 'resp-abc' });

      expect(submissionRecordRepository.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          gymId: 'gym-1',
          responseId: 'resp-abc',
          documento: '40123456',
          clientId: 'client-1',
          resultado: 'procesada',
        })
      );
    });
  });
});

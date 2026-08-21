import { describe, it, expect, vi } from 'vitest';
import { RegisterFormSentUseCase } from '../../../src/application/use-cases/client/RegisterFormSentUseCase';
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

  return { useCase: new RegisterFormSentUseCase(clientRepository), clientRepository };
}

const socio = (extra: Record<string, unknown> = {}) => ({
  id: 'client-1',
  gymId: 'gym-1',
  nombre: 'Lucía Lead',
  telefono: '5491133334444',
  createdAt: ALTA,
  fechaPrimerContacto: undefined,
  fechaFormularioEnviado: undefined,
  ...extra,
});

describe('RegisterFormSentUseCase', () => {
  it('sella el envío con el momento del request', async () => {
    const { useCase, clientRepository } = makeUseCase(socio());

    const antes = Date.now();
    await useCase.execute({ clientId: 'client-1', gymId: 'gym-1' });
    const despues = Date.now();

    const [, , data] = clientRepository.update.mock.calls[0];
    expect(data.fechaFormularioEnviado.getTime()).toBeGreaterThanOrEqual(antes);
    expect(data.fechaFormularioEnviado.getTime()).toBeLessThanOrEqual(despues);
  });

  it('el primer envío también cuenta como el primer contacto', async () => {
    const { useCase, clientRepository } = makeUseCase(socio());

    await useCase.execute({ clientId: 'client-1', gymId: 'gym-1' });

    const [, , data] = clientRepository.update.mock.calls[0];
    // Mismo instante para los dos sellos: es un solo acto, no dos.
    expect(data.fechaPrimerContacto).toEqual(data.fechaFormularioEnviado);
  });

  /*
   * Las dos fechas contestan preguntas distintas y por eso se comportan distinto: el
   * envío es "cuándo le insistí por última vez" y el contacto es "cuándo lo tocamos
   * por primera vez", que es lo que mide el KPI del embudo.
   */
  it('el reenvío corre la fecha del formulario pero NO la del primer contacto', async () => {
    const contactoOriginal = new Date('2026-03-02T12:00:00.000Z');
    const envioViejo = new Date('2026-03-02T12:00:00.000Z');
    const { useCase, clientRepository } = makeUseCase(
      socio({
        fechaPrimerContacto: contactoOriginal,
        fechaFormularioEnviado: envioViejo,
      })
    );

    const resultado = await useCase.execute({ clientId: 'client-1', gymId: 'gym-1' });

    const [, , data] = clientRepository.update.mock.calls[0];
    expect(data.fechaPrimerContacto).toBeUndefined();
    expect(data.fechaFormularioEnviado.getTime()).toBeGreaterThan(envioViejo.getTime());
    expect(resultado.fechaPrimerContacto).toEqual(contactoOriginal);
  });

  /*
   * Guardar el sello igual dejaría una ficha que afirma "formulario enviado" sobre un
   * socio al que es imposible haberle mandado nada: el listado lo sacaría de la cola
   * de pendientes y nadie volvería a mirarlo.
   */
  it('rechaza al socio sin teléfono en vez de sellar un envío imposible', async () => {
    const { useCase, clientRepository } = makeUseCase(socio({ telefono: undefined }));

    await expect(useCase.execute({ clientId: 'client-1', gymId: 'gym-1' })).rejects.toThrow(
      ValidationError
    );
    expect(clientRepository.update).not.toHaveBeenCalled();
  });

  it('404 si el socio no existe en ese gym', async () => {
    const { useCase } = makeUseCase(null);

    await expect(useCase.execute({ clientId: 'client-1', gymId: 'gym-1' })).rejects.toThrow(
      NotFoundError
    );
  });
});

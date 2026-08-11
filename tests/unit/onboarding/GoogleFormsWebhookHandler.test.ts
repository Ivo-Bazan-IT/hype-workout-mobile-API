import { describe, it, expect, vi, beforeAll } from 'vitest';
import { GoogleFormsWebhookHandler } from '../../../src/infrastructure/external/forms/GoogleFormsWebhookHandler';
import { BcryptWebhookSecretService } from '../../../src/infrastructure/encryption/BcryptWebhookSecretService';

/**
 * Se usa el servicio bcrypt REAL, no un mock: lo que estos tests tienen que probar es
 * que el aislamiento entre tenants funciona de verdad, y con una verificación
 * simulada no probarían nada.
 */
const secretService = new BcryptWebhookSecretService();

let secretoDelGym1: string;
let secretoDelGym2: string;
let hashDelGym1: string;

beforeAll(async () => {
  secretoDelGym1 = secretService.generar();
  secretoDelGym2 = secretService.generar();
  hashDelGym1 = await secretService.hash(secretoDelGym1);
});

const buildRepo = (gym: Record<string, any> | null) =>
  ({
    findById: vi.fn().mockResolvedValue(gym),
  }) as any;

describe('GoogleFormsWebhookHandler', () => {
  it('acepta el secreto propio del gym', async () => {
    const handler = new GoogleFormsWebhookHandler(
      buildRepo({ id: 'gym-1', googleFormConfig: { webhookSecretHash: hashDelGym1 } }),
      secretService
    );

    await expect(handler.verificarSecret('gym-1', secretoDelGym1)).resolves.toBe(true);
  });

  it('rechaza el secreto de otro gym', async () => {
    const handler = new GoogleFormsWebhookHandler(
      buildRepo({ id: 'gym-1', googleFormConfig: { webhookSecretHash: hashDelGym1 } }),
      secretService
    );

    await expect(handler.verificarSecret('gym-1', secretoDelGym2)).resolves.toBe(false);
  });

  it('rechaza si el gym no tiene secreto configurado, sin caer a un secreto global', async () => {
    // Antes existía GOOGLE_FORMS_DEFAULT_WEBHOOK_SECRET: un valor único que servía
    // para todos los tenants. Aunque esté seteado en el entorno, ya no debe abrir nada.
    process.env.GOOGLE_FORMS_DEFAULT_WEBHOOK_SECRET = 'secreto-global-viejo';

    const handler = new GoogleFormsWebhookHandler(
      buildRepo({ id: 'gym-1', googleFormConfig: {} }),
      secretService
    );

    await expect(
      handler.verificarSecret('gym-1', 'secreto-global-viejo')
    ).resolves.toBe(false);

    delete process.env.GOOGLE_FORMS_DEFAULT_WEBHOOK_SECRET;
  });

  it('rechaza si el gym no existe', async () => {
    const handler = new GoogleFormsWebhookHandler(buildRepo(null), secretService);

    await expect(handler.verificarSecret('missing', secretoDelGym1)).resolves.toBe(false);
  });

  it('rechaza sin lanzar si el hash guardado está corrupto', async () => {
    const handler = new GoogleFormsWebhookHandler(
      buildRepo({ id: 'gym-1', googleFormConfig: { webhookSecretHash: 'no-es-un-hash' } }),
      secretService
    );

    await expect(handler.verificarSecret('gym-1', secretoDelGym1)).resolves.toBe(false);
  });
});

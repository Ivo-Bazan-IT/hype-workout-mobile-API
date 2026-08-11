import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('4000'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  // Redis eliminado - operaciones sincrónicas

  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // DeepSeek es el proveedor de IA por defecto (API compatible con OpenAI)
  DEEPSEEK_API_KEY: z.string().optional(),
  // Solo para apuntar a otro gateway compatible; el default vive en DeepSeekProvider
  DEEPSEEK_BASE_URL: z.string().url().optional(),
  // Va DE LA MANO de DEEPSEEK_BASE_URL: cada gateway nombra los modelos a su manera
  DEEPSEEK_DEFAULT_MODEL: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  WHATSAPP_API_VERSION: z.string().default('v20.0'),
  WHATSAPP_DEFAULT_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_DEFAULT_ACCESS_TOKEN: z.string().optional(),

  // GOOGLE_FORMS_DEFAULT_WEBHOOK_SECRET se eliminó a propósito: era un secreto único
  // para todos los tenants y, con el `gymId` viajando en el body del webhook público,
  // alcanzaba para inyectar clientes en cualquier gym. Ahora cada gimnasio tiene el
  // suyo, hasheado, rotable desde POST /api/gyms/settings/google-form/rotate-secret.

  PDF_TEMPLATE_STORAGE_PATH: z.string().default('./storage/templates'),
  PDF_OUTPUT_STORAGE_PATH: z.string().default('./storage/generated'),

  ARCA_API_BASE_URL: z.string().optional(),
  ARCA_API_KEY: z.string().optional(),

  // AFIP SDK
  AFIP_SDK_API_KEY: z.string().optional(),

  // Security - Encryption key (32 bytes in hex = 64 chars)
  APP_MASTER_KEY: z.string().length(64).optional(),

  // Superadmin seed
  SUPERADMIN_EMAIL: z.string().email().optional(),
  SUPERADMIN_PASSWORD: z.string().optional(),
  SUPERADMIN_NAME: z.string().default('Super Admin'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);

// Validaciones de configuración
if (!env.DEEPSEEK_API_KEY && !env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  Warning: No AI provider API keys configured. IA features will not work.');
}

if (!env.DEEPSEEK_API_KEY) {
  console.warn('⚠️  Warning: DEEPSEEK_API_KEY no está definida y deepseek es el proveedor por defecto de los gyms nuevos.');
}

// Apuntar a otro gateway sin fijar el modelo deja el default (`deepseek-chat`)
// hablándole a un host que lo nombra distinto: falla con 400 recién al generar
// una rutina, no al arrancar. Mejor avisarlo acá.
if (env.DEEPSEEK_BASE_URL && !env.DEEPSEEK_DEFAULT_MODEL) {
  console.warn(
    '⚠️  Warning: DEEPSEEK_BASE_URL apunta a un gateway alternativo pero DEEPSEEK_DEFAULT_MODEL no está definida. ' +
      'El modelo por defecto seguirá siendo "deepseek-chat", que probablemente ese gateway no reconozca.'
  );
}

if (!env.APP_MASTER_KEY) {
  console.warn('⚠️  Warning: APP_MASTER_KEY no está definida. Las credenciales AFIP no podrán ser encriptadas.');
}
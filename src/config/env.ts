import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('4000'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  // Redis eliminado - operaciones sincrónicas

  /*
   * Quién dispara la emisión de facturas pendientes.
   *
   *  - `interno` (default): el `InvoiceEmissionScheduler` tickea dentro del proceso.
   *    Requiere que el proceso esté SIEMPRE vivo; en un tier que duerme por
   *    inactividad, el worker se duerme con él y las facturas no salen.
   *  - `cron`: el proceso no tickea. Un cron externo llama a
   *    POST /api/internal/jobs/emit-invoices. Sirve en tiers que hibernan y evita
   *    que dos instancias del server corran dos workers compitiendo por el lease.
   */
  INVOICE_WORKER_MODE: z.enum(['interno', 'cron']).default('interno'),

  // Secreto del disparador externo. Sin esto el endpoint responde 503: es un
  // gatillo de emisión de comprobantes ante AFIP, no puede quedar abierto.
  INVOICE_CRON_SECRET: z.string().min(32).optional(),

  // Tope de facturas por corrida del cron. Es más alto que el del tick interno
  // (5) porque el cron corre cada varios minutos, no cada 15 segundos: con el
  // tope chico, un backlog tardaría horas en drenar.
  INVOICE_JOB_MAX: z.string().transform(Number).default('50'),

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

  // --- AFIP SDK (facturación electrónica) ---
  /*
   * Qué modelo de cuenta factura:
   *
   *  - `cuenta_propia` (default): cada gym factura contra SU PROPIA cuenta de
   *    AFIP SDK (access token + certificado + clave, cargados por el gym en
   *    `PUT /gyms/settings/afip/credenciales`).
   *  - `cuenta_unica`: DESCONECTADO. Una sola cuenta de plataforma
   *    (`AFIP_SDK_API_KEY`) emite para todos los gyms. Se dejó de usar el
   *    19/08/2026 porque nunca se confirmó con el proveedor si su plan
   *    soporta varios CUIT bajo una cuenta; el código sigue intacto por si se
   *    retoma el día que se confirme.
   */
  AFIP_BILLING_MODE: z.enum(['cuenta_propia', 'cuenta_unica']).default('cuenta_propia'),

  /*
   * Credencial de la única cuenta de AFIP SDK. Solo se usa en modo
   * `cuenta_unica` (desconectado); en `cuenta_propia` cada gym trae la suya.
   *
   * Sigue siendo `optional()` porque un despliegue que no factura tiene que poder
   * arrancar sin ella. Su ausencia se paga al emitir, con un error que la nombra.
   */
  AFIP_SDK_API_KEY: z.string().optional(),
  // Host de la API REST. Solo se cambia para apuntar a otro gateway o a un mock.
  // El `preprocess` trata la variable vacía como ausente: en un `.env` lo natural
  // es dejar `AFIP_SDK_BASE_URL=` sin valor, y `''` no pasa la validación de URL
  // ni dispara el default, así que sin esto el proceso no arrancaría.
  AFIP_SDK_BASE_URL: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.string().url().default('https://api.afipsdk.com')
  ),
  /*
   * Contra qué ARCA se factura: `dev` = homologación, `prod` = comprobantes reales.
   *
   * OBLIGATORIA y sin default a propósito. Antes se derivaba de NODE_ENV dentro
   * del adaptador, y eso ponía una decisión fiscal —emitir de verdad o no— en
   * manos de una variable que se toca por mil motivos ajenos a la facturación.
   * Un comprobante emitido de más ante ARCA no se borra: se anula con nota de
   * crédito, que es un trámite fiscal. Que el proceso no arranque hasta que
   * alguien la escriba es más barato que descubrirlo después.
   */
  AFIP_SDK_ENVIRONMENT: z.enum(['dev', 'prod'], {
    errorMap: () => ({
      message:
        "AFIP_SDK_ENVIRONMENT es obligatoria y solo acepta 'dev' (homologación de ARCA) " +
        "o 'prod' (comprobantes fiscales reales).",
    }),
  }),

  // --- Mercado Pago (cobro de renovaciones por link) ---
  /*
   * Credenciales de la APP registrada en Mercado Pago Developers (client_id/
   * client_secret propios de la plataforma, no de cada gym). Cada gym conecta su
   * propia cuenta por OAuth vía `GET /gyms/settings/mercadopago/connect`, y estas
   * tres son las que hacen falta para armar ese flujo.
   *
   * Opcionales, a diferencia de AFIP_SDK_ENVIRONMENT: la plataforma tiene que
   * poder arrancar sin la feature activada. Faltan recién se paga al intentar
   * `connect` (400) o al recibir un webhook sin secreto configurado (503) — mismo
   * criterio "cerrado por default" que `internalAuthMiddleware`.
   */
  MERCADOPAGO_CLIENT_ID: z.string().optional(),
  MERCADOPAGO_CLIENT_SECRET: z.string().optional(),
  // Necesita ser una URL pública estable: depende del dominio propio (mismo
  // bloqueante que la cookie de sesión). En local se puede probar con un túnel.
  MERCADOPAGO_REDIRECT_URI: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.string().url().optional()
  ),
  // Secreto de la app para validar la firma `x-signature` de los webhooks
  // (Mercado Pago Developers > la app > Webhooks > Configurar notificaciones).
  MERCADOPAGO_WEBHOOK_SECRET: z.string().min(16).optional(),

  // Security - Encryption key (32 bytes in hex = 64 chars)
  APP_MASTER_KEY: z.string().length(64).optional(),

  // Superadmin seed
  SUPERADMIN_EMAIL: z.string().email().optional(),
  SUPERADMIN_PASSWORD: z.string().optional(),
  SUPERADMIN_NAME: z.string().default('Super Admin'),
});

/** Se exporta para que los tests validen las reglas del esquema sin reimportar el módulo. */
export { envSchema };

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

if (env.AFIP_BILLING_MODE === 'cuenta_unica' && !env.AFIP_SDK_API_KEY) {
  console.warn(
    '⚠️  Warning: AFIP_BILLING_MODE=cuenta_unica pero AFIP_SDK_API_KEY no está definida. ' +
      'Ningún gimnasio va a poder facturar hasta que se cargue.'
  );
}

// Los dos cruces peligrosos entre NODE_ENV y el entorno de ARCA. Ninguno se
// bloquea —hay motivos legítimos para ambos— pero los dos tienen que ser una
// decisión consciente, no un `.env` mal copiado.
if (env.AFIP_SDK_ENVIRONMENT === 'prod' && env.NODE_ENV !== 'production') {
  console.warn(
    '⚠️  Warning: AFIP_SDK_ENVIRONMENT=prod fuera de producción. Se van a emitir ' +
      'comprobantes REALES ante ARCA, que no se borran: solo se anulan con nota de crédito.'
  );
}

if (env.AFIP_SDK_ENVIRONMENT === 'dev' && env.NODE_ENV === 'production') {
  console.warn(
    '⚠️  Warning: AFIP_SDK_ENVIRONMENT=dev en producción. Las facturas van al ' +
      'homologación de ARCA y NO tienen validez fiscal.'
  );
}

// El modo `cron` apaga el worker in-process: si además falta el secreto, el
// endpoint que lo reemplaza responde 503 y NADIE emite las facturas pendientes.
// Se queda callado hasta que alguien note que no salió ninguna, así que se avisa
// fuerte al arrancar.
if (env.INVOICE_WORKER_MODE === 'cron' && !env.INVOICE_CRON_SECRET) {
  console.error(
    '❌ INVOICE_WORKER_MODE=cron pero INVOICE_CRON_SECRET no está definida. ' +
      'El worker interno está apagado y el endpoint que lo reemplaza va a rechazar todo: ' +
      'ninguna factura pendiente se va a emitir.'
  );
}
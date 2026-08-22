import { z } from 'zod';
import { AI_PROVIDERS } from '../../../domain/entities/Gym';
import { GymTaxCondition } from '../../../domain/billing/types';
import { esZonaHorariaValida } from '../../../domain/time/zonaHoraria';

/**
 * Zona horaria del gimnasio, validada contra la base IANA del runtime.
 *
 * Se valida acá y no al usarla porque una zona inexistente hace que Mongo aborte el
 * `$dateToParts` del mapa de calor: sin esta puerta, un tipeo en la configuración se
 * manifestaría semanas después como un 500 al abrir una gráfica.
 */
const zonaHoraria = z
  .string()
  .refine(esZonaHorariaValida, { message: 'Invalid IANA timezone' });

export const createGymSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  businessName: z.string().min(1, 'Business name is required'),
  cuit: z.string().min(11, 'CUIT must be at least 11 characters'),
  contactEmail: z.string().email('Valid email required'),
  contactPhone: z.string().min(10, 'Phone must be at least 10 characters'),
  adminEmail: z.string().email('Admin email required'),
  adminPassword: z.string().min(6, 'Password must be at least 6 characters'),
  adminName: z.string().min(1, 'Admin name required'),
  // CreateGymUseCase ya los soporta; sin declararlos acá, validateBody los
  // descartaba al reemplazar req.body con el resultado del parse.
  aiProvider: z.enum(AI_PROVIDERS).optional(),
  whatsappPhoneNumberId: z.string().min(1).optional(),
  // Se cifra en el caso de uso. Permite dejar el gym operativo en una sola llamada.
  whatsappAccessToken: z.string().min(1).optional(),
  timezone: zonaHoraria.optional(),
});

export const updateGymSchema = z.object({
  name: z.string().min(1).optional(),
  businessName: z.string().min(1).optional(),
  cuit: z.string().min(11).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().min(10).optional(),
  // Reactivar es el inverso del soft delete de `DELETE /admin/gyms/:id`: sin este
  // campo el `validateBody` lo descartaba y el gym quedaba inactivo para siempre.
  isActive: z.boolean().optional(),
  // WhatsApp por campos PLANOS, no como objeto `whatsappConfig`.
  //
  // Aceptar el objeto entero lo reemplazaba completo y borraba el
  // `encryptedAccessToken` del gym, que no viaja en el body por ser secreto: se
  // editaba el teléfono del gimnasio y se perdía la credencial en silencio. Estos
  // dos campos hacen merge y cifran, igual que /api/gyms/settings/whatsapp.
  whatsappPhoneNumberId: z.string().min(1).optional(),
  whatsappAccessToken: z.string().min(1).optional(),
  // Zona horaria del gimnasio. Es escalar y no un objeto de config, así que
  // reemplazarla no borra nada: no aplica el problema de merge de los otros bloques.
  timezone: zonaHoraria.optional(),
  // `aiConfig` se quitó por la misma razón: reemplazarlo borraba `encryptedApiKey`.
  // El prompt, el proveedor y la key del gym se editan con
  // PUT /api/gyms/settings/ai-prompt?gymId=<id>, que hace merge.
  pdfTemplate: z.object({
    htmlTemplate: z.string().optional(),
    cssStyles: z.string().optional(),
    storagePath: z.string().optional(),
  }).optional(),
  // `googleFormConfig` se quitó por la misma razón que `aiConfig`: reemplazar el
  // objeto entero borraba el `webhookSecretHash`, que no viaja en el body por ser
  // secreto. El formId se edita con PUT /api/gyms/settings/google-form (hace merge)
  // y el secreto se rota con POST /api/gyms/settings/google-form/rotate-secret.
});

export const updateAiConfigSchema = z
  .object({
    promptTemplate: z.string().min(1, 'Prompt template is required').optional(),
    provider: z.enum(AI_PROVIDERS).optional(),
    model: z.string().min(1).optional(),
    // API key propia del gym (BYOK). Se cifra en el caso de uso; jamás se devuelve.
    apiKey: z.string().min(1, 'API key cannot be empty').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const updateWhatsappConfigSchema = z
  .object({
    phoneNumberId: z.string().min(1, 'Phone number ID cannot be empty').optional(),
    accessToken: z.string().min(1, 'Access token cannot be empty').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

// El webhookSecret NO se acepta acá: no lo elige el gym, lo genera el backend al
// rotarlo. Este schema solo edita los campos no sensibles del Form.
export const updateGoogleFormConfigSchema = z
  .object({
    formId: z.string().min(1, 'Form ID cannot be empty').optional(),
    // Link publicado del formulario: es el que se le manda al socio por WhatsApp.
    // Se exige que sea de Google para que un error de copiado no termine mandándole
    // a un socio real una URL cualquiera desde el número del gimnasio.
    formUrl: z
      .string()
      .url('formUrl must be a valid URL')
      .refine((url) => /^https:\/\/docs\.google\.com\/forms\//.test(url), {
        message: 'formUrl must be a Google Forms link (https://docs.google.com/forms/…)',
      })
      .optional(),
    // Tal como lo escribe Google en el vínculo prellenado. Se valida el formato
    // porque un valor inventado no rompe nada visible: el Form abre igual, ignora el
    // parámetro desconocido y el socio recibe el formulario vacío sin que nadie se
    // entere de que el prellenado dejó de funcionar.
    documentoEntryId: z
      .string()
      .regex(/^entry\.\d+$/, 'documentoEntryId must look like entry.1234567890')
      .optional(),
    // Título EXACTO de la pregunta del Form que alimenta cada campo del cliente.
    // Se puede fijar solo el que la heurística resuelve mal; los omitidos conservan
    // lo que ya estaba configurado.
    fieldMapping: z
      .object({
        nombre: z.string().min(1).optional(),
        documento: z.string().min(1).optional(),
        telefono: z.string().min(1).optional(),
        email: z.string().min(1).optional(),
        // Campos de la encuesta: no son columnas del cliente, alimentan los
        // placeholders sueltos del prompt ({{cliente_objetivo}} y compañía).
        edad: z.string().min(1).optional(),
        objetivo: z.string().min(1).optional(),
        lesiones: z.string().min(1).optional(),
        diasPorSemana: z.string().min(1).optional(),
      })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const updateAfipConfigSchema = z.object({
  // Mismo criterio que el alta del gym: el CUIT también se puede corregir desde la
  // pantalla de facturación, que es donde el dueño lo necesita.
  cuit: z.string().min(11, 'CUIT must be at least 11 characters').optional(),
  // Sin `apiKey`/`cert`/`key` a propósito: en modo `cuenta_propia` esas credenciales
  // se cargan por PUT /gyms/settings/afip/credenciales (multipart), no acá. Este
  // endpoint es solo identidad fiscal. Un front viejo que las siga mandando acá no
  // rompe —`validateBody` reemplaza el body por el parseado— pero se descartan.
  puntoVenta: z.number().int().positive().optional(),
  taxCondition: z.nativeEnum(GymTaxCondition).optional(),
  isActive: z.boolean().optional(),
});

// El `apiKey` viaja como texto en el mismo multipart que `cert`/`key` (archivos,
// los procesa multer y no Zod). Al menos uno de los tres tiene que venir; esa
// regla la valida el caso de uso, que es quien sabe cuáles tres llegaron juntos.
export const updateAfipCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key no puede estar vacía').optional(),
});

// El catálogo se reemplaza ENTERO (mismo criterio que pdfTemplate), no se
// mergea: es una lista chica y el front la edita completa en una pantalla.
export const updateMembershipPlansSchema = z.object({
  planes: z
    .array(
      z.object({
        tipo: z.enum(['mensual', 'trimestral', 'semestral', 'anual']),
        duracionDias: z.number().int().positive(),
        monto: z.number().positive(),
        activo: z.boolean().default(true),
      })
    )
    .refine((planes) => new Set(planes.map((p) => p.tipo)).size === planes.length, {
      message: 'No puede haber dos planes con el mismo tipo',
    }),
});

// GET /gyms/settings/mercadopago/callback — lo llama el navegador al volver de
// mercadopago.com, no el front por su cuenta.
export const mercadoPagoCallbackSchema = z.object({
  code: z.string().min(1, 'code es requerido'),
  state: z.string().min(1, 'state es requerido'),
});

export const loginSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(1, 'Password is required'),
});
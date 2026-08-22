# API Endpoints — CRM Hype Workout

Contrato HTTP del backend, para escribir los tipos del front **sin abrir el código del
backend**. Si algo de acá no coincide con la respuesta real, manda el backend y este
documento tiene el bug.

**Base URL:** `http://localhost:PORT/api` · **Prefijo:** `/api`

> **Este archivo vive en `back/docs/` a propósito.** Antes estaba en `front/` y se
> actualizaba después de cada tanda, así que llegó a estar dos tandas atrasado: el
> documento describe el backend y se invalida justo cuando el backend cambia, de modo
> que conviene que viva al lado del código que lo invalida. Verificado archivo por
> archivo el **2026-08-21**.

---

## 1. Reglas transversales

Valen para toda la API. Es lo que más caro sale descubrir tarde.

### 1.1 El envelope

Todo viaja como `{ status, data }`:

```json
{ "status": "success", "data": { } }
```

**Lo paginado anida.** El `PaginatedResult<T>` va adentro de `data`:

```json
{
  "status": "success",
  "data": {
    "data": [],
    "total": 0,
    "page": 1,
    "limit": 20,
    "totalPages": 0
  }
}
```

O sea `response.data.data` para las filas. No es una particularidad de `/checkins`: es
el envelope de toda la API.

Los errores: `{ "status": "error", "message": "string" }`.

### 1.2 Tenant

`tenantMiddleware` es el único lugar donde se decide sobre qué gimnasio opera un
request.

| Rol | Cómo se resuelve el gym |
|---|---|
| `gym` | Siempre su propio `gymId` del JWT. No puede operar otro tenant. |
| `admin` | **`?gymId=` es obligatorio.** Sin él es `400`, en *todos* los endpoints con tenant. |

Excepción única: `GET /dashboard/summary` es deliberadamente cross-gym.

Un recurso de otro gimnasio devuelve **`404`, no `403`**: indistinguible de uno
inexistente a propósito, para no filtrar que existe.

### 1.3 `null` no es `0`

Cuando un valor no se puede calcular viaja como `null`, nunca como `0`. Dos versiones
del mismo pozo, las dos observadas en producción:

- **El cero que afirma.** `bajasEnPeriodo: 0` significa "no se fue nadie"; `null`
  significa "este mes es anterior a `datosCompletosDesde`". En una gráfica pesa más
  todavía: un mes en `0` dibuja una caída al piso y un mes ausente dibuja una recta que
  atraviesa el hueco.
- **El número grande que afirma más.** `visitasPorSocioPorSemana` llegó a devolver
  `23.2` sobre siete horas de registro. Un `null` se lee como "todavía no"; un `23,2` se
  lee como un hallazgo.

### 1.4 Unidades: hay dos monedas y no son intercambiables

| Dónde | Unidad |
|---|---|
| Bloque `financiero` de `/dashboard/kpis` y los `ingresos`/`mrr` de la serie | **Centavos enteros** |
| `Invoice.monto`, `Client.historialRenovaciones[].monto`, `ingresos` de `GET /dashboard` | **Pesos** |

Las tasas (`churnMensual`, `tasaRetencion`, `cohorte90Dias`, `tasaConversion`) son
**fracciones en `[0,1]`** — `0.05` es 5%. El dominio no formatea porcentajes.

⚠️ `engagement.visitasPorSocioPorSemana` **no es una tasa** sino un conteo decimal: no
se multiplica por 100. Lo mismo `embudo.leadsPorSemana` y
`embudo.tiempoRespuestaMinutos`.

### 1.5 Fechas: la regla es el significado, no el endpoint

| Clase | Campos | Formato |
|---|---|---|
| **Límite de período** — una medianoche, sin hora significativa | `periodo.desde/hasta`, `puntos[].desde/hasta`, `puntos[].mes`, la ventana del heatmap | `yyyy-MM-dd` (`mes` es `yyyy-MM`) |
| **Instante** — un momento real, la hora es parte del dato | `datosCompletosDesde`, `engagement.registroDesde`, `createdAt`/`updatedAt`, fechas de entidades | ISO completo |

Todos los rangos son **semiabiertos**: incluyen `desde`, excluyen `hasta`. El `hasta` de
un mes es el `desde` del siguiente.

La distinción importa más de lo que parece: una fecha de calendario formateada como
instante se muestra **corrida un día** en UTC−3, y un día es la diferencia entre llamar
a un socio y no llamarlo.

Al **enviar** fechas, usar ISO 8601 completo — salvo `desde`/`hasta` de
`/dashboard/kpis`, que van como `yyyy-MM-dd`.

### 1.6 Zona horaria: dos cortes distintos, a propósito

Se guarda todo en UTC. Después:

- **Los períodos de KPI se cortan en UTC explícito.** Sobre un agregado de 30 días, tres
  horas en el borde no cambian la lectura.
- **El día calendario y las franjas horarias se cortan en la zona del gimnasio.** Mapa
  de calor e idempotencia del check-in. Acá la hora *es* el dato: agrupado en UTC, el
  pico real de las 19:00 en Argentina aparece a las 22:00.

`Gym.timezone` es un nombre IANA validado en el alta y la edición. **Ausente significa
"no configurada"** — no se graba un default, para distinguirlo de un gym que eligió
Buenos Aires a propósito. El default (`America/Argentina/Buenos_Aires`) **viaja en la
respuesta** del heatmap, para que el front rotule el eje con lo que se usó y no con lo
que supone.

---

## 2. Autenticación (`/auth`) — público

### `POST /auth/login`

Rate limit: 5 intentos por IP cada 15 minutos.

```json
{ "email": "string", "password": "string" }
```

```json
{
  "status": "success",
  "data": {
    "accessToken": "string",
    "user": { "id": "string", "email": "string", "role": "admin | gym", "gymId": "string | null" }
  }
}
```

Además setea la cookie `refreshToken` (httpOnly, 7 días).

### `POST /auth/refresh`

Requiere la cookie `refreshToken`. Devuelve `{ accessToken, user }`.

### `POST /auth/logout`

Limpia la cookie.

### `GET /auth/me`

Requiere JWT. Devuelve `{ email, role, gymId }`.

**Uso del token:** header `Authorization: Bearer <accessToken>`.

---

## 3. Admin — Gimnasios (`/admin/gyms`)

> JWT + rol `admin`.

- **`GET /admin/gyms`** → array de gimnasios, proyección **liviana** (ver abajo).
- **`GET /admin/gyms/:id`** → el gimnasio, proyección **completa** (ver abajo).
- **`POST /admin/gyms`** → `{ gym, user }`, ambos **reducidos** (ver abajo).
- **`PUT /admin/gyms/:id`** → el gimnasio actualizado, proyección **completa**, igual que el `GET` por id.
- **`DELETE /admin/gyms/:id`** → soft delete, `{ status, message }`.

Body del alta — permite dejar el gym operativo con WhatsApp en una sola llamada:

```json
{
  "name": "string",
  "businessName": "string",
  "cuit": "string (mín 11)",
  "contactEmail": "string (email)",
  "contactPhone": "string (mín 10)",
  "adminEmail": "string (email)",
  "adminPassword": "string (mín 6)",
  "adminName": "string",
  "aiProvider": "openai | anthropic | deepseek (opcional)",
  "whatsappPhoneNumberId": "string (opcional)",
  "whatsappAccessToken": "string (opcional)",
  "timezone": "string IANA (opcional)"
}
```

Body de la edición — **todos opcionales**:

```json
{
  "name": "string",
  "businessName": "string",
  "cuit": "string",
  "contactEmail": "string",
  "contactPhone": "string",
  "isActive": "boolean",
  "whatsappPhoneNumberId": "string",
  "whatsappAccessToken": "string",
  "timezone": "string IANA",
  "pdfTemplate": { "htmlTemplate": "string", "cssStyles": "string", "storagePath": "string" }
}
```

⚠️ **La IA se edita por campos planos, no como objeto.** Mandar `aiConfig` entero
reemplazaría el objeto y borraría la API key cifrada, que no viaja en el body por ser
secreto. El prompt y la credencial de IA se editan por
`PUT /gyms/settings/ai-prompt?gymId=<id>`, que hace merge. `googleFormConfig` tampoco se
edita por acá, por la misma razón (borraría `webhookSecretHash`): usar
`PUT /gyms/settings/google-form` y `POST /gyms/settings/google-form/rotate-secret`.

`whatsappPhoneNumberId`/`whatsappAccessToken` **sí** viajan como campos planos en este
mismo body (a diferencia de `aiConfig`/`googleFormConfig`) porque `UpdateGymUseCase` los
cifra y mergea antes de guardar — no reemplazan el objeto `whatsappConfig` entero.

`timezone` inválida (nombre que no es IANA) devuelve `400`.

**Las tres formas de response no son la misma proyección — ojo si el front las mezcla:**

```jsonc
// GET /admin/gyms (lista) — liviana, sin aiConfig/whatsappConfig/afipConfig/timezone
{
  "id": "string", "name": "string", "businessName": "string", "cuit": "string",
  "contactEmail": "string", "contactPhone": "string", "isActive": "boolean",
  "createdAt": "ISO instante", "updatedAt": "ISO instante"
}
```

```jsonc
// GET /admin/gyms/:id y PUT /admin/gyms/:id — proyección completa
{
  "id": "string", "name": "string", "businessName": "string", "cuit": "string",
  "contactEmail": "string", "contactPhone": "string", "isActive": "boolean",
  "aiConfig": { "provider": "string | undefined", "model": "string | undefined", "hasApiKey": "boolean" },
  "whatsappConfig": { "phoneNumberId": "string", "hasAccessToken": "boolean" },
  "googleFormConfig": { "formId": "string | undefined" },
  "timezone": "string | undefined",
  "afipConfig": { "puntoVenta": "number", "taxCondition": "string", "isActive": "boolean" } | "undefined",
  "createdAt": "ISO instante", "updatedAt": "ISO instante"
}
```

⚠️ Acá `aiConfig` **no** trae `promptTemplate`/`usaPromptStandard` (a diferencia de
`GET /gyms/settings` §5), `googleFormConfig` **solo** trae `formId` (sin `formUrl`,
`documentoEntryId`, etc.) y `afipConfig` **no** trae los `has*`/`credencialesActualizadasEn`.
Son proyecciones de admin, no las mismas que ve el propio gimnasio.

```jsonc
// POST /admin/gyms — subconjunto reducido, no el gym/user completos
{
  "gym": { "id": "string", "name": "string", "businessName": "string", "cuit": "string" },
  "user": { "id": "string", "email": "string", "name": "string" }
}
```

---

## 4. Admin — Usuarios (`/admin/users`)

> JWT + rol `admin`.

- **`GET /admin/users`** y **`GET /admin/users/search`** → paginado, con filtros de query.
- **`GET /admin/users/:id`**
- **`POST /admin/users`**
- **`PUT /admin/users/:id`**
- **`PUT /admin/users/:id/password`**
- **`DELETE /admin/users/:id`**

---

## 5. Gimnasio propio (`/gyms`)

> JWT + tenant.

### `GET /gyms/settings`

Allowlist explícito de campos no sensibles. **Ningún secreto sale por acá**: ni el token
de WhatsApp, ni la API key de IA, ni la de AFIP, ni el hash del secreto del webhook.

```json
{
  "status": "success",
  "data": {
    "id": "string",
    "name": "string",
    "businessName": "string",
    "cuit": "string",
    "contactEmail": "string",
    "contactPhone": "string",
    "isActive": "boolean",
    "aiConfig": {
      "provider": "openai | anthropic | deepseek | undefined",
      "promptTemplate": "string",
      "usaPromptStandard": "boolean",
      "model": "string | undefined",
      "hasApiKey": "boolean"
    },
    "pdfTemplate": { },
    "whatsappConfig": { "phoneNumberId": "string | null", "hasAccessToken": "boolean" },
    "whatsappPhoneNumberId": "string | null",
    "googleFormConfig": {
      "formId": "string | null",
      "formUrl": "string | null",
      "documentoEntryId": "string | null",
      "hasWebhookSecret": "boolean",
      "webhookSecretUpdatedAt": "ISO instante | null",
      "fieldMapping": { }
    },
    "afipConfig": {
      "puntoVenta": "number",
      "taxCondition": "string",
      "isActive": "boolean",
      "hasApiKey": "boolean",
      "hasCert": "boolean",
      "hasKey": "boolean",
      "credencialesActualizadasEn": "ISO instante | null"
    },
    "mercadoPagoConfig": {
      "conectado": "boolean",
      "hasAccessToken": "boolean",
      "hasWebhookSecret": "boolean",
      "credencialesActualizadasEn": "ISO instante | null"
    },
    "membershipPlans": [
      { "tipo": "mensual | trimestral | semestral | anual", "duracionDias": "number", "monto": "number (PESOS)", "activo": "boolean" }
    ],
    "createdAt": "ISO instante",
    "updatedAt": "ISO instante"
  }
}
```

⚠️ **`googleFormConfig` NO tiene `webhookSecret`.** El secreto se guarda hasheado con
bcrypt y sale una sola vez, por la rotación. Declarar el campo en el tipo del front fue
un bug real.

`afipConfig` es `undefined` si el gym nunca configuró facturación.
`aiConfig.promptTemplate` es el prompt **efectivo**: si el gym nunca escribió el suyo,
llega el standard ya cargado y `usaPromptStandard: true` permite avisar que todavía no
lo personalizó.

### `PUT /gyms/settings/ai-prompt`

Body: `{ promptTemplate, provider?, model?, apiKey? }`. Devuelve `{ aiConfig }` con la
misma forma segura de arriba.

### `PUT /gyms/settings/whatsapp`

Devuelve `{ whatsappConfig: { phoneNumberId, hasAccessToken } }`.

### `PUT /gyms/settings/afip`

Body: `{ cuit?, puntoVenta?, taxCondition?, isActive? }`, todos opcionales.

Devuelve `{ cuit, afipConfig }` con la misma forma segura de `GET /gyms/settings`.

- Es solo **identidad fiscal**: quién factura, con qué punto de venta y bajo qué régimen.
  La credencial de AFIP SDK (cuenta propia del gym) se carga aparte, por
  `PUT /gyms/settings/afip/credenciales`. Un cliente viejo que mande `apiKey` acá no
  rompe —se descarta en la validación— pero tampoco se guarda.
- **`taxCondition` solo admite `MONOTRIBUTO` o `RESPONSABLE_INSCRIPTO`.** `EXENTO` ya no
  existe: el producto se vende a entidades con fines de lucro. Mandarlo da `400`.
- **`cuit`** es el del gimnasio **emisor** — a nombre de quién sale la factura, no el del
  socio. Se acepta con guiones o puntos; el backend lo normaliza. Vive en la raíz del gym
  (`GET /gyms/settings` → `data.cuit`) y se puede editar desde acá porque es donde el dueño
  lo necesita. `409` si otro gimnasio ya lo usa.

Se pueden mandar todos juntos: `{ cuit, puntoVenta, taxCondition, isActive: true }` en una
sola llamada deja la identidad fiscal configurada, pero **no alcanza para facturar**: sin
la credencial de `PUT /gyms/settings/afip/credenciales`, la primera emisión queda en
`error` con un mensaje que lo explica.

### `PUT /gyms/settings/afip/credenciales`

**`multipart/form-data`**, no JSON: `apiKey` como campo de texto (el access token de
`app.afipsdk.com`), `cert` y `key` como archivos (el `.crt` y el `.key` que entrega AFIP
para ese CUIT). Los tres son opcionales — se puede rotar uno solo — pero hace falta mandar
al menos uno.

Devuelve `{ afipConfig }`, igual que arriba: nunca el contenido de las credenciales, solo
`hasApiKey` / `hasCert` / `hasKey` / `credencialesActualizadasEn`.

Cada gimnasio factura contra **su propia cuenta** de AFIP SDK (no hay cuenta compartida de
plataforma): sin las tres credenciales cargadas, ninguna factura de ese gym sale de
`pendiente`.

### `PUT /gyms/settings/google-form`

```json
{
  "formId": "string (opcional)",
  "formUrl": "string (opcional)",
  "documentoEntryId": "string (opcional)",
  "fieldMapping": {
    "nombre": "string", "documento": "string", "telefono": "string", "email": "string",
    "edad": "string", "objetivo": "string", "lesiones": "string", "diasPorSemana": "string"
  }
}
```

Las ocho claves son opcionales. Los valores son el **título exacto de la pregunta** del
Form que alimenta cada campo. `nombre`, `documento`, `telefono` y `email` alimentan
columnas de la ficha; `edad`, `objetivo`, `lesiones` y `diasPorSemana` alimentan
placeholders del prompt.

`formUrl` y `documentoEntryId` son los que permiten **mandarle al socio el formulario
con su documento ya cargado**, que es lo que evita el rebote por DNI mal tipeado:

| Campo | Qué es | Validación |
|---|---|---|
| `formUrl` | El link publicado del Form, el que abre el socio | Tiene que empezar con `https://docs.google.com/forms/` |
| `documentoEntryId` | El campo del DNI dentro de ese link | Formato `entry.1234567890` |

Los dos salen del **vínculo prellenado** que genera Google (⋮ → Obtener vínculo
prellenado). Sin `documentoEntryId` el envío sigue funcionando: se manda el formulario
pelado y el socio tipea el documento a mano.

⚠️ **El merge no sabe borrar.** Se mergea campo por campo, así que **vaciar una pregunta
no borra el mapeo**: el merge no puede expresar un borrado. Un body vacío `{}` devuelve
`400` ("At least one field must be provided").

Devuelve `{ googleFormConfig }` con la forma segura.

### `POST /gyms/settings/google-form/rotate-secret`

```json
{
  "status": "success",
  "data": {
    "secret": "string",
    "webhookSecretUpdatedAt": "ISO instante | null",
    "message": "Guardá este secreto ahora: no se puede volver a consultar."
  }
}
```

⚠️ **Es el único punto del sistema por donde sale el secreto en claro.** Se guarda
hasheado: si el gym no lo copia acá, no lo recupera y tiene que rotar de nuevo. Rotar
**invalida el anterior**, así que el Apps Script empieza a recibir `401` hasta que
alguien pegue el nuevo. Es `POST` y no `PUT` porque no es idempotente.

### `PUT /gyms/settings/mercadopago/credenciales`

> **Cambió el 22/08/2026.** Reemplazó al flujo OAuth (`GET .../connect` +
> `GET /mercadopago/callback`, ver §5 bis vieja más abajo si hace falta releerla en un
> commit anterior). Cada gimnasio carga **su propia cuenta** de Mercado Pago a mano,
> mismo patrón que `PUT /gyms/settings/afip/credenciales` — sin popup, sin login dentro
> de la app, sin app de plataforma que registrar en Mercado Pago Developers.

**JSON normal** (a diferencia de AFIP, acá no hay archivos):

```json
{ "accessToken": "string (opcional)", "webhookSecret": "string, mín 16 caracteres (opcional)" }
```

Al menos uno de los dos. `400` si no se manda ninguno.

- `accessToken`: el access token de **producción** (Checkout Pro) de la cuenta del gym en
  Mercado Pago — no vence por tiempo, solo si el dueño lo rota a mano desde su panel. El
  backend lo valida llamando a `GET /users/me` de Mercado Pago con ese token: si no sirve,
  `502` y no se guarda nada. Si sirve, el `id` que devuelve esa llamada se guarda como
  `mpUserId` — **el dueño no lo tipea**, sale solo.
- `webhookSecret`: el secreto de **la integración del gym** en Mercado Pago Developers
  (Tus integraciones → su app → Webhooks → Configurar notificaciones). Cada gym tiene el
  suyo — no hay uno compartido de plataforma.

Devuelve `{ mercadoPagoConfig }` con la misma forma segura de `GET /gyms/settings`. Nunca
el contenido de las credenciales, solo `hasAccessToken` / `hasWebhookSecret` /
`credencialesActualizadasEn`.

### `DELETE /gyms/settings/mercadopago`

Desconecta la cuenta. `{ status, message }`. Después de esto, `GET /gyms/settings` vuelve
a mostrar `mercadoPagoConfig: { conectado: false, hasAccessToken: false, hasWebhookSecret:
false, credencialesActualizadasEn: null }`, y `POST /clients/:id/renewal-requests` empieza
a rechazar con `400` hasta que se recarguen las credenciales.

### `PUT /gyms/settings/membership-plans`

Reemplaza el catálogo **completo** (no mergea, a diferencia de `ai-prompt`/`whatsapp`): el
front manda la lista entera cada vez, igual que `pdfTemplate`.

```json
{
  "planes": [
    { "tipo": "mensual", "duracionDias": 30, "monto": 15000, "activo": true },
    { "tipo": "trimestral", "duracionDias": 90, "monto": 40000, "activo": true },
    { "tipo": "semestral", "duracionDias": 180, "monto": 70000, "activo": false },
    { "tipo": "anual", "duracionDias": 365, "monto": 130000, "activo": true }
  ]
}
```

Devuelve `{ membershipPlans }`. `400` si hay dos planes con el mismo `tipo`, o si algún
`monto`/`duracionDias` no es positivo. **No hace falta cargar los cuatro tipos**: un gym
puede tener solo `mensual` configurado, y los demás simplemente no aparecen como opción al
elegir plan.

Este catálogo alimenta **dos caminos de cobro**, no solo Mercado Pago: también
`POST /clients/:id/renew` con `tipoPlan` (§6), para que un cobro en efectivo calcule el
mismo monto y la misma duración sin que el operador tenga que tipearlos a mano.

---

## 5 bis. Mercado Pago — webhook (público, no lo llama el front)

Única superficie sin JWT de esta integración, porque del otro lado no hay un usuario
logueado: es Mercado Pago avisando un pago. El resto (cargar credencial, desconectar,
catálogo, pedir un link) requiere sesión y está en §5/§6.

### `POST /mercadopago/webhook`

**El front nunca lo llama.** Lo dispara Mercado Pago cuando un pago cambia de estado.

> **Cambió el 22/08/2026.** El secreto para verificar la firma ya no es único de
> plataforma: es el de **la integración del gym** (cargado por
> `PUT /gyms/settings/mercadopago/credenciales`). Por eso este endpoint primero busca a
> qué gym pertenece la notificación por su `user_id` —lo único del body que sirve para
> eso— y recién con ESE gym encontrado verifica la firma con su secreto.

Orden real de validación:

1. `type`/`data.id`/`user_id` ausentes o con forma rara → `200` con
   `{ procesado: false, motivo: "Payload inesperado" }`. No hay nada que reintentar.
2. Ningún gym conectado con ese `user_id` → `200` con `{ procesado: false, motivo: "..." }`.
   No es un error: puede ser ruido, o una integración de otra plataforma.
3. El gym existe pero no cargó su `webhookSecret` → `503` (cerrado por default, no
   abierto — mismo criterio que `internalAuthMiddleware`).
4. Firma inválida (falta el header, o no calza) → `401`.
5. El gym no cargó su `accessToken` → `503`.
6. Firma OK → sigue al caso de uso, que vuelve a pedirle el pago real a Mercado Pago
   antes de tocar cualquier dato (nunca confía en el body del webhook a secas).

No hay nada que el front tenga que integrar acá — se documenta para que quede claro que
existe y por qué una renovación por Mercado Pago tarda unos segundos en reflejarse: el
pago se confirma de forma asíncrona, no en la respuesta de
`POST /clients/:id/renewal-requests`.

---

## 6. Clientes (`/clients`)

> JWT + tenant.

### `GET /clients` · `GET /clients/search`

Query: `gymId?` (admin), `query?`, `estado?` (`activo|inactivo|pendiente`), `page` (1),
`limit` (20).

Devuelve `PaginatedResult<Client>` — recordar el anidado de §1.1.

```json
{
  "id": "string",
  "gymId": "string",
  "nombre": "string",
  "documento": "string",
  "telefono": "string | undefined",
  "email": "string | undefined",
  "estado": "activo | inactivo | pendiente",
  "fechaInicio": "ISO instante",
  "fechaVencimiento": "ISO instante",
  "esRecurrente": "boolean",
  "historialRenovaciones": [{ "fecha": "ISO instante", "monto": "number (PESOS)" }],
  "encuestaData": { },
  "fechaConversion": "ISO instante | undefined",
  "fechaPrimerContacto": "ISO instante | undefined",
  "condicionFiscal": "RESPONSABLE_INSCRIPTO | CONSUMIDOR_FINAL | undefined",
  "cuit": "string | undefined",
  "createdAt": "ISO instante",
  "updatedAt": "ISO instante"
}
```

`condicionFiscal` ausente se trata como `CONSUMIDOR_FINAL` (es la condición de la enorme
mayoría de los socios). Decide, junto con la condición fiscal del gimnasio, qué comprobante
le corresponde al renovar — ver §10. `cuit` solo hace falta cuando es `RESPONSABLE_INSCRIPTO`.

⚠️ **`estado: 'inactivo'` es borrado lógico, no una baja del gimnasio.** El front lo
rotula "Eliminado" y no lo cuenta como churn. Quién está activo de verdad lo decide
`fechaVencimiento`.

⚠️ **`fechaConversion` ausente NO significa "no convirtió".** Significa una de dos cosas
y se distinguen mirando `encuestaData`:

- `encuestaData` vacío o ausente → **es un lead**, todavía no contestó.
- `encuestaData` con respuestas → **convirtió antes de que el campo existiera** (08/08).
  La conversión es real; lo que no se registró es *cuándo*. No se hizo backfill con
  `updatedAt` a propósito: habría sido un dato inventado con cara de dato real.

Un badge guiado solo por `fechaConversion` marca como leads a **todos los socios viejos
del gimnasio**.

### `GET /clients/expiring?days=7`

Array de clientes que vencen ese día.

### `GET /clients/:id`

El cliente. `404` si no existe **o es de otro gimnasio**.

### `POST /clients`

**Alta mínima:** solo `nombre` y `documento` son obligatorios.

```json
{
  "nombre": "string",
  "documento": "string",
  "telefono": "string (mín 10, opcional)",
  "email": "string (email, opcional)",
  "fechaInicio": "ISO (opcional)",
  "fechaVencimiento": "ISO (opcional)",
  "encuestaData": { },
  "condicionFiscal": "RESPONSABLE_INSCRIPTO | CONSUMIDOR_FINAL (opcional)",
  "cuit": "string, mín 11 caracteres (opcional)"
}
```

Sin fechas se aplica el default de 30 días. Responde `201`. `400` si `condicionFiscal` es
`RESPONSABLE_INSCRIPTO` y `cuit` no viene o no tiene 11 dígitos.

### `PUT /clients/:id`

Todos los campos opcionales: `nombre`, `documento`, `telefono`, `email`, `estado`,
`fechaVencimiento`, `encuestaData`, `condicionFiscal`, `cuit`. Misma validación de CUIT que
el alta, evaluada sobre el estado **final** del cliente (lo que llega en este PUT más lo que
ya tenía) — un PUT que solo cambia `condicionFiscal` a `RESPONSABLE_INSCRIPTO` sin `cuit`
también da `400` si el cliente no tenía uno cargado antes.

### `PATCH /clients/:id/encuesta`

```json
{
  "telefono": "string (opcional)",
  "email": "string (opcional)",
  "encuestaData": { }
}
```

`encuestaData` es obligatorio y **no puede estar vacío** (`400`). Se **fusiona** con lo
ya cargado, no lo reemplaza. Devuelve la ficha actualizada.

### `POST /clients/:id/contacto`

```json
{ "fecha": "ISO (opcional)" }
```

⚠️ **Es idempotente y tiene que serlo.** Con el socio ya contactado **devuelve la ficha
con la fecha que ya tenía**, sin tocar nada, y responde `200`. El KPI mide el *primer*
contacto; si ganara el último, mediría "cuándo hablamos por última vez".

Por eso la UI puede llamarlo sin miedo a duplicar, pero **no puede ofrecerlo como
"actualizar fecha de contacto"**.

`fecha` sirve para cargar hacia atrás: el contacto real suele ser un llamado o un
WhatsApp que se registra más tarde, y sin ese parámetro el KPI mediría la demora
administrativa en vez de la comercial.

| Caso | Respuesta |
|---|---|
| `fecha` futura | `400` — daría un tiempo de respuesta negativo |
| `fecha` anterior al `createdAt` del cliente | `400` — mediría contra un lead que no existía |
| Cliente de otro gym | `404` |

### `POST /clients/:id/formulario-enviado`

Sin body. Registra que se le mandó al socio el **formulario de ingreso** por WhatsApp y
devuelve la ficha actualizada.

El mensaje **no sale del backend**: lo dispara una persona desde su propio WhatsApp con
un link `wa.me`, porque la Cloud API de Meta no deja escribirle primero a alguien que no
escribió antes salvo con una plantilla aprobada. Este endpoint asienta la acción del
operador, no la entrega del mensaje.

Escribe dos fechas con reglas distintas:

| Campo | Comportamiento |
|---|---|
| `fechaFormularioEnviado` | **Se pisa en cada llamada.** Contesta "¿cuándo le insistí por última vez?" |
| `fechaPrimerContacto` | **Solo si estaba vacío.** Mandarle el formulario ES el primer contacto, y el KPI mide el primero |

| Caso | Respuesta |
|---|---|
| Socio sin `telefono` | `400` — no hay a dónde mandarlo, y el sello mentiría |
| Cliente de otro gym | `404` |

### `POST /clients/:id/renew` — cobro en efectivo/transferencia, EN EL MOMENTO

Confirma un cobro que **ya ocurrió** (el operador tiene la plata o la transferencia ya
llegó) y aplica la renovación al instante — a diferencia de
`POST /clients/:id/renewal-requests` (más abajo), que no renueva nada hasta que Mercado
Pago confirma el pago.

**Dos formas de body, la primera es la recomendada:**

```jsonc
// Por catálogo — resuelve monto y vencimiento desde gym.membershipPlans (§5)
{ "tipoPlan": "mensual" | "trimestral" | "semestral" | "anual" }
```

```jsonc
// Manual — para un monto que no calza con ningún plan del catálogo (una promo, un
// ajuste). A diferencia de tipoPlan, extiende siempre 30 días desde HOY, no desde
// el vencimiento del socio.
{ "monto": "number (positivo, PESOS)" }
```

Hay que mandar **uno de los dos**, no ninguno. `400` si `tipoPlan` no está configurado (o
está `activo: false`) en el catálogo del gym.

Deja el evento de membresía del que salen los KPIs, y si el gym factura, encola el
comprobante — igual que siempre. Además: **si el socio tenía un link de Mercado Pago
pendiente, este endpoint lo cancela** (queda `estado: "cancelado"` en su historial). Es a
propósito — un cobro en efectivo confirmado reemplaza cualquier link todavía cobrable, para
que el socio no termine pagando la misma cuota dos veces si abre el link viejo por error.

### `POST /clients/:id/renewal-requests` — pedir un link de pago de Mercado Pago

```json
{ "tipoPlan": "mensual" | "trimestral" | "semestral" | "anual" }
```

**Siempre por catálogo** (no acepta `monto` suelto): no tiene sentido generar un link por
un importe que el gym no definió como plan. `400` si el gym no cargó su credencial de
Mercado Pago (§5) o si el `tipoPlan` no está configurado.

```jsonc
// Response 201
{
  "status": "success",
  "data": {
    "id": "string",
    "clientId": "string",
    "plan": { "tipo": "mensual", "duracionDias": 30, "monto": 15000 },
    "externalReference": "string (uuid)",
    "initPoint": "string (URL — es lo que se le mandó al socio por WhatsApp)",
    "estado": "pendiente",
    "fechaVencimientoAnterior": "ISO instante",
    "fechaVencimientoNueva": "ISO instante (ya calculada — se aplica tal cual cuando MP confirme)",
    "createdAt": "ISO instante"
  }
}
```

⚠️ **Esto NO renueva al socio.** `Client.estado`/`fechaVencimiento` no cambian acá: la
renovación real la aplica el webhook (§5 bis) recién cuando Mercado Pago confirma el pago,
en segundo plano. El front tiene que mostrar "link enviado, esperando pago" y no un check
verde.

El link también se manda por WhatsApp automáticamente (mismo mecanismo que las rutinas)
si el socio tiene `telefono` cargado — si no, o si falla el envío, el link igual queda
válido y se puede compartir a mano copiando `initPoint`.

**Pedir un link nuevo cancela cualquier link pendiente anterior** del mismo socio: no
pueden convivir dos links cobrables a la vez.

### `GET /clients/:id/renewal-requests`

Query: `estado?` (`pendiente|aprobado|rechazado|expirado|cancelado`), `page` (1), `limit`
(20). Devuelve `PaginatedResult<RenewalRequest>` (mismo anidado de §1.1, misma forma que
la respuesta de arriba). Es de acá de donde el front deriva el badge "Renovación
Pendiente (Semestral)" en el listado — **no existe un campo así en `Client`**, a propósito:
así los cálculos de churn/MRR de los KPIs (que sí miran `Client.estado`) no se ven
afectados por un link todavía sin pagar.

### `DELETE /clients/:id`

Soft delete → `estado: 'inactivo'`. `{ status, message }`.

---

## 7. Check-ins (`/checkins`)

> JWT + tenant.

### `POST /checkins`

```json
{ "clientId": "string", "fecha": "ISO (opcional, default: ahora)" }
```

Responde `201` con el `CheckIn` (`{ id, gymId, clientId, fecha, createdAt, updatedAt }`).

⚠️ **El registro es IDEMPOTENTE POR DÍA**, y el día se corta en la zona horaria del
gimnasio. El segundo POST del mismo socio la misma fecha devuelve **`201` con el mismo
registro**, no un error ni un duplicado: está pensado para molinetes y mostradores donde
el segundo click sale de la duda de si el primero anduvo.

La consecuencia es que **una respuesta exitosa no significa "entró alguien nuevo"**:
comparar el `id` devuelto con el anterior es la única forma de distinguir el ingreso
nuevo de la repetición. Un contador que suma por cada `201` cuenta de más.

| Caso | Respuesta |
|---|---|
| Socio vencido | `201` — el vencimiento se avisa, no bloquea. Es la señal de que volvió |
| Socio `inactivo` (borrado) | `400` |
| Socio inexistente o de otro gym | `404` |

### `GET /checkins`

Query: `clientId?`, `desde?`, `hasta?` (ISO), `page` (1), `limit` (20, **tope 500**).

Devuelve `PaginatedResult<CheckInListItem>`:

```json
{
  "id": "string",
  "gymId": "string",
  "clientId": "string",
  "clientNombre": "string | null",
  "fecha": "ISO instante",
  "createdAt": "ISO instante",
  "updatedAt": "ISO instante"
}
```

**`clientNombre` viaja resuelto.** `null` significa **socio borrado**, y la fila no
desaparece: una asistencia vieja de alguien eliminado sigue siendo un hecho, y perder la
fila entera sería peor que perder el nombre.

`page` y `limit` se validan como enteros positivos: `?page=abc` da `400`, no `500`. El
tope de 500 es una red de seguridad, no el camino previsto — para el mapa de calor está
`/checkins/heatmap`.

### `GET /checkins/heatmap?semanas=8`

`semanas`: entero 1–52, default 8.

```json
{
  "status": "success",
  "data": {
    "zonaHoraria": "America/Argentina/Buenos_Aires",
    "desde": "yyyy-MM-dd",
    "hasta": "yyyy-MM-dd",
    "registroDesde": "ISO instante | null",
    "celdas": [{ "dia": 1, "hora": 19, "total": 12 }]
  }
}
```

- **`dia` es ISO-8601: 1 = lunes … 7 = domingo.** No es la numeración de Mongo ni la de
  JavaScript, que arrancan en domingo. Confundirlas corre el mapa entero un día.
- `hora` va de 0 a 23 **en la hora de pared del gimnasio**, no en UTC.
- **Las celdas en cero NO vienen**: el resultado es disperso. "No vino nadie" y "todavía
  no se registraba asistencia" se distinguen con `registroDesde`, no con la ausencia de
  la celda.
- `desde`/`hasta` son límites de ventana en la zona del gimnasio (`yyyy-MM-dd`, `hasta`
  exclusivo). `registroDesde` es un **instante** y va con hora: son marcos distintos y
  compararlos recortados pondría la banda rayada un día corrida.
- **`zonaHoraria` viaja en la respuesta** para que el eje se rotule con lo que se usó y
  no con lo que el front supone.

---

## 8. Rutinas (`/routines`)

> JWT + tenant.

### `GET /routines`

Query: `gymId?` (admin), `clientId?`, `estadoEnvio?`, `estadoGeneracion?`,
`vencimientoDesde?`, `vencimientoHasta?`, `page` (1), `limit` (20, tope 100).

Devuelve `PaginatedResult<RoutineListItem>` — la rutina completa **más `clientNombre`**:

```json
{
  "id": "string",
  "gymId": "string",
  "clientId": "string",
  "clientNombre": "string | null",
  "promptUsado": "string | undefined",
  "contenidoGenerado": { },
  "pdfUrl": "string | undefined",
  "estadoGeneracion": "pendiente | generando | generado | error",
  "estadoEnvio": "pendiente | enviando | enviado | error",
  "whatsappMessageId": "string | undefined",
  "fechaGeneracion": "ISO instante | undefined",
  "fechaVencimiento": "ISO instante",
  "createdAt": "ISO instante",
  "updatedAt": "ISO instante"
}
```

Los filtros trabajan **sobre el gimnasio entero**, no sobre una página. El rango de
vencimiento es semiabierto. Orden: más reciente primero. `clientNombre` en `null` es
socio borrado, igual que en `/checkins`.

#### ⚠️ `fechaVencimiento` es el de la RUTINA, no el de la cuota

La planificación es **mensual**: una rutina generada el día X vence el día **X+30**, y
la invariante `fechaVencimiento = fechaGeneracion + 30 días` vale siempre. Es hasta
cuándo le sirve al socio *ese plan de entrenamiento*.

**No es** `client.fechaVencimiento`, que dice hasta cuándo pagó la cuota. Son dos
preguntas distintas y se mueven por separado: un socio que renueva a mitad de mes sigue
con la misma rutina hasta que esta venza, y uno que dejó de pagar conserva una rutina
vigente que ya nadie va a usar.

> 📌 **Cambió el 19-08.** Hasta esa fecha el campo guardaba el vencimiento de la
> membresía, así que una pantalla de "rutinas por vencer" mostraba en realidad
> vencimientos de cuotas. El campo, su tipo y su lugar en el JSON no cambiaron —**solo
> el valor**—, así que el front no rompe, pero cualquier texto que diga "vence la
> membresía" al lado de este dato ahora miente. Las rutinas viejas se corrigen en la
> base con `npm run backfill:vencimiento-rutinas`.

### `GET /routines/:id`

La rutina. `404` si es de otro gimnasio.

### `GET /routines/client/:clientId`

Array de rutinas del socio, más reciente primero.

### `GET /routines/expiring?days=7`

`{ "count": number, "days": number }`.

Cuántas rutinas vencen **dentro de los próximos `days` días**, contando desde el arranque
de hoy. Es acumulativo: `days=7` incluye a las que vencen mañana.

Una rutina que venció hoy más temprano **sí** cuenta —sigue siendo la que hay que renovar
hoy—; una que venció ayer, no.

Para ver las filas y no solo el número, `GET /routines?vencimientoDesde=…&vencimientoHasta=…`.

> 📌 **Cambió el 19-08.** Antes contaba las que vencían *exactamente* el día `days`-ésimo,
> así que una rutina a 4 días no aparecía con `days=7`, `days=5` ni `days=3`. El número que
> devuelve ahora es mayor o igual al de antes.

### `GET /routines/:id/pdf`

El PDF de la rutina.

### `POST /routines/generate/:clientId`

**Es sincrónico y responde `200`**, no `202`: la rutina ya está generada cuando vuelve.

```json
{
  "status": "success",
  "message": "string",
  "data": { "...rutina": "", "fuenteCredencial": "propia | respaldo", "estadoEnvio": "string" }
}
```

`fuenteCredencial` distingue una rutina generada con el modelo que el gym configuró de
una que salió por el respaldo de la plataforma. `estadoEnvio` viaja para no tener que
volver a pedir la rutina solo para saber si salió.

### `POST /routines/:id/resend`

Reintenta el envío por WhatsApp.

### `DELETE /routines/:id`

Borrado duro — a diferencia del socio, la rutina no tiene estado `inactivo`. `{ status, message }`.
El PDF en storage no se borra: no hay puerto para eso.

---

## 9. Dashboard (`/dashboard`)

> JWT. El tenant se aplica **por ruta**: `/summary` es cross-gym y no lo lleva.

### `GET /dashboard`

```json
{
  "status": "success",
  "data": {
    "clientesActivos": "number",
    "clientesRecurrentes": "number",
    "rutinasPorVencer": { "en7Dias": "number", "en5Dias": "number", "en3Dias": "number" },
    "rutinasSinEnviar": "number",
    "ingresos": { "mesActual": "number (PESOS)", "mesPrevio": "number (PESOS)" }
  }
}
```

**`clientesActivos` cuenta membresías vigentes o en gracia** — el mismo universo que
`socios.activos` de `/dashboard/kpis`, y tiene que seguir dando el mismo número: las dos
cifras conviven en la misma pantalla. Los borrados lógicos no cuentan en ninguno.

`clientesRecurrentes` es un **subconjunto** de `clientesActivos` (mismo filtro de
vigencia, más "renovó al menos dos veces"), así que la tarjeta "N de M activos" siempre
cierra.

`rutinasSinEnviar` son las generadas que nunca salieron hacia el socio. **Acá un `0` SÍ
es un dato real** —"no hay ninguna trabada"— y por eso va como número y no como `null`.

**`rutinasPorVencer` es acumulativo y los tres contadores se anidan**: `en3Dias ⊆ en5Dias ⊆
en7Dias`. Cada uno cuenta las rutinas que vencen entre hoy y dentro de esos días, así que
ninguna queda fuera de los tres. La fecha que miran es el vencimiento de la **rutina**
—30 días desde que se generó—, no el de la cuota del socio; ver §8.

> 📌 **Cambió el 19-08** en dos frentes a la vez: los contadores pasaron de "el día N
> exacto" a "dentro de N días", y el dato que leen pasó de ser el vencimiento de la
> membresía al de la rutina. Los tres números van a subir respecto de lo que el front
> venía mostrando. Las rutinas viejas se corrigen con `npm run backfill:vencimiento-rutinas`.

⚠️ **`ingresos` sale de las facturas AFIP y hoy casi siempre da `$0`**, porque la mayoría
de los gyms no tiene facturación activa. El ingreso real —el de las renovaciones— está en
`/dashboard/kpis`, en centavos.

### `GET /dashboard/kpis`

Query: `gymId?` (admin), `desde` / `hasta` en `yyyy-MM-dd`, **opcionales pero juntos**.
Mandar uno solo devuelve `400`. Sin ninguno, el mes calendario en curso. Rango
semiabierto.

```json
{
  "status": "success",
  "data": {
    "periodo": { "desde": "yyyy-MM-dd", "hasta": "yyyy-MM-dd" },
    "datosCompletosDesde": "ISO instante | null",
    "socios": {
      "activos": "number",
      "enGracia": "number",
      "altasEnPeriodo": "number",
      "bajasEnPeriodo": "number | null",
      "crecimientoNeto": "number | null"
    },
    "retencion": {
      "churnMensual": "number | null",
      "tasaRetencion": "number | null",
      "cohorte90Dias": "number | null"
    },
    "financiero": {
      "ingresosPeriodo": "number (CENTAVOS)",
      "mrr": "number (CENTAVOS)",
      "arpu": "number | null (CENTAVOS)",
      "ltv": "number | null (CENTAVOS)"
    },
    "engagement": {
      "visitasPorSocioPorSemana": "number | null",
      "enRiesgo": {
        "total": "number",
        "socios": [{ "id": "string", "nombre": "string | null" }]
      },
      "registroDesde": "ISO instante | null"
    },
    "embudo": {
      "leadsNuevos": "number",
      "leadsPorSemana": "number | null",
      "conversionesEnPeriodo": "number",
      "sinConvertir": "number",
      "sinContactar": "number",
      "tasaConversion": "number | null",
      "ventanaConversionDias": "number",
      "tiempoRespuestaMinutos": "number | null"
    }
  }
}
```

`engagement.enRiesgo` es `null` entero (no un objeto vacío) mientras no haya 14 días de
registro. Lo mismo el bloque completo si el gym nunca registró una asistencia.

**Semánticas que no se deducen del JSON:**

1. **`socios.activos` incluye a los que están en gracia.** Los estados son
   `vigente | en_gracia | de_baja`, y activo es "no está de baja". Por lo tanto
   **`socios.enGracia` es un subconjunto de `socios.activos`, no una categoría
   hermana.** La gracia son 5 días y significa que renovar tarde es pagar tarde, no
   darse de baja y volver.
2. **`socios.activos` es puntual a HOY, no del período.** Pedir los KPIs de febrero no
   cambia ese número.
3. **`visitasPorSocioPorSemana` viene en `null` con menos de 7 días de registro**, y el
   corte aplica también si el rango pedido es corto: sobre 3 días, un promedio semanal
   sigue siendo una extrapolación ×2,3. `registroDesde` viaja igual, para poder explicar
   el hueco con una fecha en vez de un "no hay datos".
4. **`enRiesgo` usa otro umbral —14 días— y por otra razón:** no se puede afirmar que
   alguien lleva dos semanas sin venir si hay menos de dos semanas de registro. Los dos
   umbrales son distintos a propósito.
5. **`ltv` es `null` cuando el churn es `null` o `0`** (con churn 0 sería infinito).
6. **`datosCompletosDesde` marca desde cuándo el historial es confiable.** Si el período
   pedido empieza antes, todo `retencion` más `bajasEnPeriodo` y `crecimientoNeto`
   vuelven en `null`. No es un error.

**El embudo va al revés de la intuición.** Un **lead** es un `Client` **sin encuesta
contestada**; la conversión es contestarla. Consecuencia: **quien entra por el Google
Form ya llega convertido**, porque la submission trae las respuestas. Los leads son las
altas manuales que todavía no completaron la ficha.

"Conversión" acá significa **completó el onboarding**, no "se hizo socio y pagó" — el
pago ocurre *antes* que la encuesta en este flujo. El benchmark del 30–50% de cualquier
material de gimnasios no aplica.

Tres cosas más del embudo:

- **`tasaConversion` viene en `null` casi siempre y no está roto.** Es una tasa de
  cohorte **censurada**: solo entran los leads que ya tuvieron sus 90 días completos. En
  el mes en curso ninguno cumplió la ventana.
- **El movimiento del día a día son los cuatro conteos crudos** (`leadsNuevos`,
  `conversionesEnPeriodo`, `sinConvertir`, `sinContactar`), dato real siempre.
- **`conversionesEnPeriodo` y "los convertidos de `leadsNuevos`" no son lo mismo.** Un
  lead que entró en enero y contestó en marzo suma a la cohorte de enero y a las
  conversiones de marzo. **No hay ninguna cuenta en la que
  `leadsNuevos - sinConvertir === conversionesEnPeriodo`, y forzarla sería un bug.**

El bloque `embudo` **viaja siempre**, incluso antes de `datosCompletosDesde`: sale de
`Client` y no del stream de eventos de membresía.

### `GET /dashboard/kpis/series?meses=12`

`meses`: entero 1–24, default 12.

```json
{
  "status": "success",
  "data": {
    "datosCompletosDesde": "ISO instante | null",
    "puntos": [
      {
        "mes": "yyyy-MM",
        "desde": "yyyy-MM-dd",
        "hasta": "yyyy-MM-dd",
        "ingresos": "number (CENTAVOS)",
        "mrr": "number (CENTAVOS)",
        "altas": "number",
        "bajas": "number | null",
        "crecimientoNeto": "number | null",
        "churnMensual": "number | null",
        "tasaRetencion": "number | null"
      }
    ]
  }
}
```

- **Siempre devuelve los meses pedidos, incluidos los vacíos**, con sus ceros reales. Un
  mes ausente del array y un mes con valores en cero se dibujan distinto: el primero
  traza una recta que atraviesa el hueco.
- Del más viejo al más nuevo: la gráfica se lee de izquierda a derecha.
- `mrr` es al cierre de **su** mes, no al de hoy: si no, la línea sería una recta con el
  valor actual repetido.
- El punto del mes en curso coincide con `/dashboard/kpis` sin parámetros. Es contrato,
  no coincidencia, y vale también para `churnMensual` y `tasaRetencion`.
- **`churnMensual` y `tasaRetencion` son fracciones `[0,1]`**, sin formatear — mismas
  unidades que el bloque `retencion` de `/dashboard/kpis`. Van en `null` en los meses
  anteriores a `datosCompletosDesde`, por la misma razón que `bajas`, y también cuando el
  mes **arranca con la base en cero**: sin socios al inicio no hay denominador, y un 0%
  de churn afirmaría que no se fue nadie de un padrón que no existía. Los primeros meses
  de un gimnasio nuevo vienen así.
- La retención excluye del numerador a las altas del propio mes: mide quién **sobrevivió**,
  no cuánta gente hay al final. Un mes de mucha adquisición no la infla.
- **`cohorte90Dias` no está en la serie y no va a estar.** Es una cohorte móvil medida
  contra *hoy*, no una métrica del mes: repetida en doce puntos daría el mismo valor doce
  veces con cara de evolución. Sigue disponible en `/dashboard/kpis`.

`datosCompletosDesde` sale en **el mismo formato que en `/dashboard/kpis`**: instante ISO
completo. Antes el mismo campo viajaba en dos formatos según el endpoint.

### `GET /dashboard/summary`

> Rol `admin`. **Cross-gym**: no lleva tenant.

Hoy devuelve un placeholder. Es del panel de plataforma, no del CRM del gimnasio.

---

## 10. Facturación (`/invoices`)

> JWT + tenant.

### `GET /invoices`

Query: `gymId?` (admin), `clientId?`, `estado?` (`emitida|anulada|error|pendiente`),
`tipoComprobante?`, `cae?`, **`emitidaDesde?` / `emitidaHasta?`**, `page` (1), `limit`
(20, tope 100).

Devuelve `PaginatedResult<Invoice>`:

```json
{
  "id": "string",
  "gymId": "string",
  "clientId": "string",
  "tipoComprobante": "Factura A | Factura B | Factura C",
  "codigoTipoComprobante": "number | undefined (1 | 6 | 11)",
  "puntoVenta": "number | undefined",
  "numeroComprobante": "number | undefined",
  "cae": "string",
  "vencimientoCae": "ISO instante | undefined",
  "monto": "number (PESOS, total con IVA)",
  "neto": "number | undefined",
  "iva": "number | undefined",
  "descripcion": "string | undefined",
  "fechaEmision": "ISO instante",
  "estado": "emitida | anulada | error | pendiente",
  "errorLog": "string | undefined",
  "intentos": "number",
  "proximoIntento": "ISO instante | undefined",
  "createdAt": "ISO instante",
  "updatedAt": "ISO instante"
}
```

**Los campos fiscales son `undefined` mientras el comprobante no esté emitido.** Una factura
nace en `pendiente`, sin CAE ni número: los completa el worker al obtener la autorización.
Un comprobante queda identificado ante AFIP por la terna
`puntoVenta` + `codigoTipoComprobante` + `numeroComprobante`; el CAE solo lo autoriza.

**El tipo de comprobante depende de DOS condiciones fiscales: la del gimnasio y la del
socio** (`Client.condicionFiscal`, `RESPONSABLE_INSCRIPTO | CONSUMIDOR_FINAL`, default
`CONSUMIDOR_FINAL`):

- Gym `MONOTRIBUTO` → siempre **Factura C** (código 11, sin IVA discriminado), sin mirar
  al socio.
- Gym `RESPONSABLE_INSCRIPTO` + socio `RESPONSABLE_INSCRIPTO` → **Factura A** (código 1),
  facturada al **CUIT** del socio (`Client.cuit`), no a su DNI.
- Gym `RESPONSABLE_INSCRIPTO` + socio `CONSUMIDOR_FINAL` → **Factura B** (código 6), con el
  IVA desagregado del precio en `neto`/`iva`.

Un socio marcado `RESPONSABLE_INSCRIPTO` sin `cuit` válido no se puede facturar: la factura
queda en `error` hasta que se cargue.

`monto` es el total con IVA incluido y es lo que suman los reportes de ingresos. En
monotributo `neto === monto` e `iva === 0`.

⚠️ **Los filtros de fecha se llaman `emitidaDesde` / `emitidaHasta`.** Mandar
`desde`/`hasta` no filtra nada y **no avisa**: Zod descarta las claves desconocidas.

⚠️ **No existe `/clients/:id/invoices` y no hace falta.** `GET /invoices?clientId=` hace
exactamente eso. Un `404` en esa ruta es un bug del cliente HTTP, no un hueco del
backend.

### `GET /invoices/revenue`

Query: `gymId?`, `desde?`, `hasta?`. Devuelve el reporte con desglose mensual:
`{ desde, hasta, total, cantidad, porMes: [{ year, month, total, cantidad }] }`.

Solo cuenta las `emitida`. Las `pendiente` todavía no son plata cobrada ante AFIP y las
`error` quedan persistidas para auditoría, no para sumar.

### `GET /invoices/:id`

El comprobante. `404` si es de otro gimnasio.

### `POST /invoices/:id/retry`

Devuelve a la cola de emisión una factura que quedó en `error`. Responde `200` con la
factura ya en `pendiente` (`intentos` en `0`) y el mensaje
`"La factura volvió a la cola de emisión."`.

- `400` si la factura **no** está en `error`. Reencolar una `emitida` la facturaría dos
  veces; una `pendiente` ya está en la cola.
- `404` si es de otro gimnasio.

**No espera a AFIP.** El `200` confirma que la factura volvió a la cola, no que el
comprobante salió: la emisión la hace el worker unos segundos después. Para saber cómo
terminó hay que releer la factura.

### Ciclo de vida de una factura

```
renovación del socio ──> pendiente ──emite OK──> emitida
                             │  ▲
                             │  └── reintento automático (fallo transitorio, hasta 5)
                             │  └── POST /invoices/:id/retry (fallo de validación, manual)
                             └──fallo definitivo──> error
```

**La renovación de un socio no espera a AFIP.** `POST /clients/:id/renew` deja el
comprobante en `pendiente` y responde; un worker in-process lo emite después. Consecuencias
para el front:

- Después de renovar, la factura **existe pero todavía no tiene CAE**. Si la pantalla lo
  muestra, tiene que contemplar el estado `pendiente`.
- Que la renovación devuelva `200` **no significa que se facturó**. Son dos cosas
  distintas a propósito: la mayoría de los gyms no tiene facturación activa, y un problema
  con AFIP nunca debe dejar al socio sin renovar.
- Los fallos **transitorios** (AFIP caído, timeout) se reintentan solos con backoff, hasta
  5 intentos. Los de **validación** (CUIT del gym mal cargado, punto de venta inexistente,
  DNI del socio incompleto) van directo a `error` con el detalle en `errorLog`, porque
  reintentarlos sin corregir el dato falla igual.
- Si el gimnasio no tiene `afipConfig.isActive`, **no se encola nada**.

---

## 11. Uso de IA (`/ai-usage`)

> JWT + tenant.

- **`GET /ai-usage`** → listado paginado del consumo.
- **`GET /ai-usage/report`** → reporte agregado.

---

## 12. Onboarding (`/onboarding`)

### `POST /onboarding/webhook` — público

Lo llama Google Apps Script, que no tiene JWT. Header `x-webhook-secret` obligatorio.
Rate limit: 100 requests por IP cada 15 minutos.

```json
{ "gymId": "string", "respuestas": { }, "responseId": "string (opcional)" }
```

Responde `201` con `{ clientId, nombre, estado }`.

⚠️ **El webhook ya no crea clientes.** Una respuesta con un DNI desconocido devuelve
`404` y no crea nada. El onboarding es secuencial: **se carga al socio en el panel →
paga → contesta el formulario.** Un DNI que no está es un tipeo, no un socio nuevo.

**La recuperación:** dar de alta al socio y **reenviar la respuesta desde el panel de
Google Forms**. Llega con el mismo `responseId` y el backend la reprocesa en vez de
tratarla como duplicada.

El único campo imprescindible del formulario es el **documento**. Secreto inválido →
`401`.

### `GET /onboarding/status`

> JWT + tenant. **No es público**: son datos del tenant, con DNI incluido.

```json
{
  "status": "success",
  "data": {
    "configurado": "boolean",
    "fieldMapping": { } ,
    "submissions": {
      "total": "number",
      "procesadas": "number",
      "rechazadas": "number",
      "ultimaRecibidaEn": "ISO instante | null",
      "ultimoResultado": "procesada | rechazada | null"
    },
    "ultimosRechazos": [
      { "documento": "string | null", "motivo": "string | null", "recibidaEn": "ISO instante" }
    ]
  }
}
```

`fieldMapping` es `null` si el gym no declaró ninguno (se resuelve por heurística).

⚠️ **`configurado` no significa "está entrando".** Solo dice que el gym generó su
secreto. **El disparador vive en Google y el backend no lo puede consultar.** La única
prueba de que el circuito funciona es `submissions.ultimaRecibidaEn`. Por eso el semáforo
del front tiene tres estados y no dos.

---

## 12 bis. Interno (`/internal`) — no es del front

> **Esta sección no la consume el front.** La llama nuestra propia infraestructura.
> Se documenta acá para que nadie la descubra por accidente y la crea pública.

### `POST /internal/jobs/emit-invoices`

Dispara una corrida de emisión de las facturas en estado `pendiente`. Es exactamente el
mismo trabajo que hace el worker in-process, entrando por HTTP en vez de por temporizador.

**Autenticación:** header `x-internal-secret` con el valor de `INVOICE_CRON_SECRET`.
**No lleva JWT** — quien llama es una máquina, no un usuario, y la tarea opera sobre
*todos* los gimnasios, así que tampoco pasa por `tenantMiddleware`. Un JWT de admin **no**
sirve para entrar acá.

Respuesta `200`:

```json
{ "status": "success",
  "data": { "procesadas": 3, "emitidas": 2, "fallidas": 1, "truncado": false } }
```

| Campo | Significado |
|---|---|
| `procesadas` | Facturas tomadas de la cola en esta corrida |
| `emitidas` | Las que consiguieron CAE |
| `fallidas` | Las que fallaron (vuelven a la cola con backoff, o quedan en `error`) |
| `truncado` | Quedó cola sin tocar por agotarse el cupo (`INVOICE_JOB_MAX`) o los 25s de presupuesto |

⚠️ **`truncado: true` sostenido en el tiempo es una alarma**, no un detalle: significa que
la cadencia del cron no da abasto con el volumen y hay que acortar el intervalo o subir
`INVOICE_JOB_MAX`. Es el único indicador de que la cola se está acumulando.

| Código | Cuándo |
|---|---|
| `401` | Falta el header, o el secreto no coincide |
| `429` | Más de 30 llamadas por minuto |
| `503` | `INVOICE_CRON_SECRET` no está configurada en el servidor |

El `503` es deliberado: sin secreto el endpoint se **cierra**, no se abre. Un gatillo de
emisión de comprobantes ante AFIP accesible sin credencial es peor que uno caído.

**Correr dos veces en paralelo es seguro** — el lease atómico de `claimPendiente` impide
que dos corridas se lleven la misma factura — pero no hace falta: `INVOICE_WORKER_MODE`
elige uno u otro disparador, no los dos.

---

## 13. Códigos de estado

| Código | Cuándo |
|---|---|
| `200` | OK |
| `201` | Creado (incluye el check-in idempotente que devuelve el registro existente) |
| `400` | Validación, o `admin` sin `?gymId=` |
| `401` | Sin token, token inválido, o secreto de webhook incorrecto |
| `403` | Rol incorrecto |
| `404` | No existe, fue borrado, **o es de otro gimnasio** |
| `429` | Rate limit |
| `500` | Error del servidor |

Un `404` puede significar tres cosas distintas. Tratarlas todas como "función no
disponible" le miente al usuario.

---

## 14. Decisiones cerradas

No reabrir sin motivo nuevo.

- **Las fechas se serializan por significado, no por endpoint** (§1.5).
- **Los dos cortes de zona horaria son distintos** (§1.6). No es incoherencia: son dos
  preguntas distintas.
- **El `limit` de `/checkins` queda en 500** como red de seguridad. El camino previsto es
  `/checkins/heatmap`.
- **El webhook no vuelve a crear clientes.**
- **`POST /clients/:id/contacto` no actualiza la fecha.**
- **`POST /clients/:id/formulario-enviado` sí la actualiza**, pero solo la del envío: el
  primer contacto lo sella una única vez.
- **La serie sale de UNA sola lectura del historial.** Hay un test que cuenta
  invocaciones al puerto. Es la razón de existir del endpoint.
- **`Client.estado: 'inactivo'` es borrado lógico**, no una baja del gimnasio.
- **Un socio vencido puede registrar ingreso**; uno `inactivo` da `400`; uno de otro
  gimnasio da `404`.
- **No hay ni va a haber** pantalla de clases, reservas, CAC, payback, margen bruto ni
  trials.

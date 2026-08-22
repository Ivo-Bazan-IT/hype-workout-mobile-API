# Requerimientos del backend — orden de trabajo

> **Actualizado el 2026-08-21 (front):** **F1, F2 y F3 quedaron implementadas y
> verificadas en vivo contra este backend** — ver
> [§2 octies](#2-octies-hecho-el-21-08-frontend--f1-f2-y-f3-implementadas-y-verificadas-en-vivo-).
> Ya no hay ninguna pantalla de front pendiente en el tablero. Lo único que sigue abierto
> es configuración/pruebas manuales, no código: correr los dos scripts
> ([S1](#01-correr-los-dos-scripts-contra-la-base-)), probar AFIP y Mercado Pago contra
> cuentas de test reales ([0.2](#02-probar-la-facturación-contra-el-homologación-de-arca-)/
> [0.4](#04-probar-mercado-pago-contra-una-cuenta-de-test-real-)), y las dos decisiones de
> infraestructura (D1/D2).
>
> Actualizado el **2026-08-21**: se agregó la **pasarela de pago con Mercado Pago** para
> renovar membresías por link —ver
> [§2 septies](#2-septies-hecho-el-21-08--pasarela-de-pago-con-mercado-pago-)—. El operador
> elige un plan del catálogo, el CRM genera el link y se lo manda por WhatsApp; recién
> cuando Mercado Pago confirma el pago (webhook), el CRM renueva al socio y encola la
> factura. El cobro en efectivo/transferencia (`POST /clients/:id/renew`) ahora habla el
> mismo catálogo de planes y cancela cualquier link que haya quedado pendiente.
>
> **Ya no queda nada abierto del lado del código, ni backend ni front.** F1
> (facturación), F2 (vencimiento de rutinas) y F3 (Mercado Pago) — las tres pantallas que
> este documento pedía — están hechas y probadas en vivo. Las tres secciones siguen acá
> como especificación completa **y guía de testing**, por si hace falta releerlas. El
> backend sigue probado de punta a punta (813 tests, uno rojo preexistente y sin relación
> — fecha hardcodeada en `GenerateRoutineUseCase.test.ts:266` —, `tsc` y build limpios).
>
> **Dos tareas que no son de código bloquean el deploy:** comprar el dominio
> ([D1](#d1--comprar-el-dominio--antes-del-deploy)) y decidir el tier de hosting
> ([D2](#d2--tier-de-pago-para-el-backend--al-primer-gimnasio-que-pague)). El D1 no es
> opcional: sin dominio propio la sesión **no funciona en producción**, por la cookie —y
> ahora tampoco el callback de OAuth de Mercado Pago, que necesita una URL pública estable.
>
> El contrato de la API dejó de vivir acá. Ahora está en
> **[`docs/API_ENDPOINTS.md`](docs/API_ENDPOINTS.md)**, al día y verificado archivo por
> archivo. Este documento vuelve a ser lo que dice el título: qué falta hacer — más, en
> F1/F2/F3, el detalle que hace falta para poder testear cada pantalla.

---

## 0. Dónde retomar

**Lo primero de la próxima sesión, en este orden.** Son tres cosas que quedaron listas en el
código pero **sin ejecutar**, porque tocan la base o dependen de un tercero.

### 0.1 Correr los dos scripts contra la base ⏳

Ninguno se corrió todavía. Los dos leen `MONGO_URI` del `.env`, **que hoy apunta al Atlas de
producción**: mirar contra qué base se está apretando enter antes de hacerlo.

| Script | Qué arregla | Si no se corre |
|---|---|---|
| `npm run purge:afip-keys` | Borra de Mongo las credenciales de AFIP por gimnasio, que ya salieron del schema | Quedan credenciales cifradas de terceros guardadas sin que nada las lea |
| `npm run backfill:vencimiento-rutinas` | Recalcula el vencimiento de las rutinas ya generadas | **Las rutinas viejas siguen mostrando el vencimiento de la cuota.** Recargar el server NO lo corrige: el código decide qué se guarda al generar una rutina nueva, no reescribe lo ya guardado |

Los dos son idempotentes: correrlos dos veces deja el mismo resultado.

### 0.2 Probar la facturación contra el homologación de ARCA ⏳

Con `AFIP_SDK_ENVIRONMENT=dev` y credenciales reales de AFIP SDK (registrarse en
`app.afipsdk.com`, generar `access_token` y subir el `.crt`/`.key` de un CUIT de prueba). El
circuito está probado de punta a punta contra un mock del paquete `@afipsdk/afip.js`
(`tests/e2e/facturacionCuentaPropia.test.ts`, 8 tests), pero **el mock acepta cualquier
cosa**: lo que falta ver es qué contesta AFIP de verdad.

A diferencia de antes del 20-08, ya no hay una incógnita sobre el contrato — se verificó
leyendo el código fuente publicado de `@afipsdk/afip.js`, no la doc, que estaba incompleta
(detalle en [§2 sexies.2](#2-el-adaptador-real-no-el-inventado-)). Lo que sigue sin
probarse contra el servicio real de AFIP:

1. **Que el par cert/key realmente autentique** vía WSAA contra homologación — la librería
   arma `Auth.Token`/`Sign` sola, pero nunca se corrió con un certificado real, solo mockeado.
2. **Que `CondicionIVAReceptorId` no rebote con error 10242** ("no es un valor válido/es
   obligatorio") en algún caso borde no cubierto por los tests — el mapeo (RI→1, resto→5) se
   confirmó contra la tabla de `FEParamGetCondicionIvaReceptor`, pero esa tabla no documenta
   restricciones adicionales fuera de `Cmp_Clase`.

**El CUIT de prueba tiene que tener 11 dígitos** después de sacar guiones y puntos, o la
factura queda en `error` sin llegar a AFIP.

### 0.3 Las tres pantallas del front ✅ hecho el 21-08

[F1](#f1--pantalla-de-facturación-qué-tiene-que-cargar-el-gimnasio),
[F2](#f2--vencimiento-de-rutinas-textos-y-contadores) y
[F3](#f3--pantalla-de-mercado-pago-conectar-catálogo-y-botón-de-renovación) están
implementadas y verificadas en vivo contra este backend — detalle completo en
[§2 octies](#2-octies-hecho-el-21-08-frontend--f1-f2-y-f3-implementadas-y-verificadas-en-vivo-).
Ya no hay nada que "retomar" acá.

### 0.4 Probar Mercado Pago contra una cuenta real ⏳

Mismo pendiente que tuvo AFIP SDK en su momento ([§0.2](#02-probar-la-facturación-contra-el-homologación-de-arca-)):
el circuito está probado de punta a punta contra un mock de `axios`
(`tests/e2e/renovacionMercadoPago.test.ts`, 8 tests), pero el mock acepta cualquier cosa.

> **Cambió el 22/08/2026** — ver [§2 novies](#2-novies-hecho-el-22-08--mercado-pago-sin-oauth-credencial-directa-por-gym-):
> ya no hace falta registrar ninguna app en Mercado Pago Developers ni cargar variables de
> entorno de plataforma. Lo único que falta es una prueba manual con una cuenta real:

1. **Conseguir el Access Token de producción** de una cuenta de Mercado Pago (Tus
   integraciones → Credenciales de producción) y cargarlo por
   `PUT /gyms/settings/mercadopago/credenciales` desde el front. El backend lo valida
   llamando a `GET /users/me` — si no sirve, tira `502` ahí mismo, antes de guardar nada.
2. **Configurar el webhook de ESA integración** (Tus integraciones → su app → Webhooks →
   Configurar notificaciones) apuntando a `https://<tu-túnel-o-dominio>/api/mercadopago/webhook`,
   y cargar el secreto que da esa pantalla en el mismo `PUT` de arriba (`webhookSecret`).
3. **Correr el flujo completo**: pedir un link (`POST /clients/:id/renewal-requests`),
   pagarlo con una tarjeta de prueba, y confirmar que el webhook real llega con la forma
   que el código espera. ⚠️ El manifest exacto del HMAC de la firma
   (`id:…;request-id:…;ts:…;`) se armó a partir de las guías públicas de Mercado Pago,
   **no se pudo confirmar contra un webhook real todavía** — es la misma clase de
   incógnita que tuvo `CondicionIVAReceptorId` con AFIP, y se resuelve igual: mirando qué
   llega de verdad antes de confiar en la doc a ciegas.

Sin dominio propio (D1 sigue pendiente), el paso 2 necesita un túnel (ngrok) apuntando al
puerto local mientras tanto — igual que antes, pero ahora es lo único que depende de eso:
ya no hay `MERCADOPAGO_REDIRECT_URI` de OAuth que armar.

---

## 1. Tablero

| Id | Prioridad | Tarea | Toca | Rompe al front |
|---|---|---|---|---|
| [D1](#d1--comprar-el-dominio--antes-del-deploy) | **P0** | Comprar el dominio | **Nada de código** — es una compra | No |
| [D2](#d2--tier-de-pago-para-el-backend--al-primer-gimnasio-que-pague) | P2 | Tier de pago para el backend | **Nada de código** — es config de hosting | No |
| [F1](#f1--pantalla-de-facturación-qué-tiene-que-cargar-el-gimnasio) | ✅ hecho | Pantalla de facturación: CUIT, punto de venta, condición fiscal y credencial propia de AFIP SDK (apiKey + .crt + .key) | **Front** — hecho y verificado en vivo el 21-08 | No — campos nuevos |
| [F2](#f2--vencimiento-de-rutinas-textos-y-contadores) | ✅ hecho | Vencimiento de rutinas: textos y contadores | **Front** — verificado, no necesitó cambios | No — mismo campo, otro significado |
| [F3](#f3--pantalla-de-mercado-pago-conectar-catálogo-y-botón-de-renovación) | ✅ hecho | Pantalla de Mercado Pago: conectar cuenta, catálogo de planes y botón de renovación en la ficha del socio | **Front** — hecho y verificado en vivo el 21-08 | No — flujo nuevo |
| [S1](#01-correr-los-dos-scripts-contra-la-base-) | **P1** | Correr `purge:afip-keys` y `backfill:vencimiento-rutinas` | **Nada de código** — es ejecutar dos scripts | No |
| [S2](#04-probar-mercado-pago-contra-una-cuenta-real-) | P2 | Cargar una credencial real de Mercado Pago y probar el flujo | **Nada de código** — carga de credencial + prueba manual | No |
| [P3-B](#p3-b--embudo-en-la-serie-mensual) | P3 | Embudo en la serie mensual | `GetGymKpisSeriesUseCase` + `IMetricsRepository` | No — aditivo |

**No hay nada abierto del lado del código, ni backend ni front.** D1 y D2 son decisiones de
infraestructura, no tareas de programación, pero D1 es **P0 porque bloquea el deploy**: sin
dominio propio la sesión se rompe en producción por el `sameSite` de la cookie —y ahora
tampoco funciona el callback de Mercado Pago, que necesita una URL de redirect pública—. F1,
F2 y F3 **ya están hechas** (21-08, ver [§2 octies](#2-octies-hecho-el-21-08-frontend--f1-f2-y-f3-implementadas-y-verificadas-en-vivo-)):
sin F1 no se podía facturar y sin F3 no se podía cobrar por Mercado Pago, y las dos rutas
ya funcionan de punta a punta contra este backend. S1 y S2 son configuración/ejecución, no
código, y son lo único que sigue pendiente de verdad. P3-B está anotada, no pedida, y
necesita una decisión de diseño del puerto antes de tocar nada.

Lo que se cerró está en [§3 Hecho](#3-hecho-en-la-tanda-del-10-08), con la evidencia de
dónde quedó cada cosa, porque la mitad de esas correcciones son invisibles desde afuera y
conviene poder encontrarlas.

---

## 2. Lo que queda

### D1 — Comprar el dominio — **antes del deploy**

**No es código. Es una compra, y bloquea el deploy.**

Hoy `AuthController` marca la cookie del refresh token como `sameSite: 'strict'`
(`AuthController.ts:21`). Eso significa que el browser **solo la manda si el front y la API
están en el mismo sitio registrable**. En desarrollo funciona porque `localhost:5173` y
`localhost:4000` son el mismo sitio. En producción depende de dónde quede cada cosa:

| Dónde queda cada cosa | ¿Viaja la cookie? | Qué pasa |
|---|---|---|
| `app.tudominio.com` + `api.tudominio.com` | Sí | ✅ Funciona sin tocar código |
| Todo en un solo servicio, un solo origen | Sí | ✅ Funciona, y además **desaparece el CORS** |
| `xxx.vercel.app` + `yyy.onrender.com` | **No** | ❌ `/auth/refresh` da 401 siempre: **nadie puede entrar** |

La tercera fila es la trampa, y es el camino por defecto si uno deploya sin pensarlo:
`.vercel.app` y `.onrender.com` están en la Public Suffix List, así que cuentan como sitios
**distintos**. La alternativa sería pasar la cookie a `sameSite: 'none'`, que además de
debilitar la protección CSRF te deja expuesto al bloqueo de cookies de terceros que los
browsers vienen apretando. **No vale la pena: el dominio cuesta menos que el problema.**

Y lo ibas a necesitar igual por marca — no se onboardea un gimnasio que paga a
`hype-workout.onrender.com`. Que resuelva la cookie es un efecto secundario gratis.

- **Costo:** `.com.ar` en NIC.ar es barato; un `.com` ronda los USD 12/año.
- **Qué hacer después de comprarlo:** apuntar front y API a subdominios del mismo dominio,
  y setear `CORS_ORIGIN` al origen real del front (hoy default `http://localhost:5173`).

### D2 — Tier de pago para el backend — al primer gimnasio que pague

**Tampoco es código.** Es elegir cuándo dejar de estar en el tier gratuito.

El motivo original ya no aplica: el worker de facturación era in-process y un tier que
hiberna lo dormía con el proceso, así que las facturas no salían. **Eso quedó resuelto**
en [§2 quater](#2-quater-hecho-el-15-08--sesión-que-sobrevive-al-f5-y-worker-por-cron-) —
con `INVOICE_WORKER_MODE=cron` un cron externo despierta el servicio y dispara la emisión.

Lo que **no** resuelve el cron es el cold start del usuario: si el servicio se durmió, el
dueño del gimnasio que abre el CRM espera ~50 segundos a que levante. Eso no se arregla con
arquitectura, se arregla pagando.

| Etapa | Qué conviene |
|---|---|
| Pre-revenue, demos | Free tier + `INVOICE_WORKER_MODE=cron`. Se aceptan los cold starts a cambio de $0 |
| Primer gimnasio pagando | Instancia always-on (~USD 7/mes). Se puede volver a `interno` o dejar el cron |

MongoDB Atlas M0 es gratis y **no hiberna** — es una base, no un servicio web. No entra en
esta decisión.

⚠️ Ojo con el atajo de "pingear el servicio cada 10 minutos para que no se duerma": el free
tier de Render da 750 horas-instancia al mes y 24/7 son ~730. Funciona, pero quedás al 97%
del tope con un solo servicio y dependiendo de que no te lo corten.

### F1 — Pantalla de facturación: qué tiene que cargar el gimnasio

**Es trabajo del front. El backend está listo, probado de punta a punta y esta sección es
también la guía para testearlo** — por API (curl) y manual dentro de la app.

Sin esta pantalla **no se puede facturar**: el CUIT del emisor y la credencial propia de
AFIP SDK solo se pueden cargar desde acá. Sin ellos la factura queda encolada para siempre
en `pendiente` (si falta la identidad fiscal) o pasa a `error` apenas el worker la toma (si
falta la credencial).

#### Los datos que hacen falta para que salga una factura

| Dato | Quién lo carga | Dónde | Obligatorio |
|---|---|---|---|
| **CUIT del gimnasio** | Dueño | `PUT /gyms/settings/afip` → `cuit` | Sí |
| **Punto de venta** | Dueño | `PUT /gyms/settings/afip` → `puntoVenta` | Sí |
| **Condición fiscal del gimnasio** | Dueño | `PUT /gyms/settings/afip` → `taxCondition` | Sí |
| **Facturación activa** | Dueño | `PUT /gyms/settings/afip` → `isActive: true` | Sí |
| **Access token de AFIP SDK** (`app.afipsdk.com`) | Dueño | `PUT /gyms/settings/afip/credenciales` → `apiKey` | Sí |
| **Certificado `.crt`** | Dueño | `PUT /gyms/settings/afip/credenciales` → `cert` (archivo) | Sí |
| **Clave privada `.key`** | Dueño | `PUT /gyms/settings/afip/credenciales` → `key` (archivo) | Sí |
| **DNI del socio** | Dueño | `POST /clients` → `documento` | Sí |
| **Condición fiscal del socio** | Dueño | `POST\|PUT /clients` → `condicionFiscal` | No — default `CONSUMIDOR_FINAL` |
| **CUIT del socio** | Dueño | `POST\|PUT /clients` → `cuit` | Solo si el socio es `RESPONSABLE_INSCRIPTO` |

Más el **monto de la cuota**, que va en `POST /clients/:id/renew` y es lo que dispara todo.

**Cada gimnasio factura contra SU PROPIA cuenta de AFIP SDK** —no hay credencial
compartida de plataforma—, así que el paso de credenciales **no es opcional ni se puede
saltear**: sin él, cargar identidad fiscal no alcanza para emitir (ver el guion de error
más abajo). Detalle completo del porqué en
[§2 sexies](#2-sexies-hecho-el-20-08--vuelta-a-cuenta-propia-factura-a-y-credenciales-por-gym-).

#### 1. Configurar la identidad fiscal — `PUT /api/gyms/settings/afip`

Todos los campos son opcionales *en el request* (se puede guardar de a uno), pero los cuatro
tienen que estar cargados —y las credenciales del paso 2— para poder emitir.

```bash
curl -X PUT http://localhost:4000/api/gyms/settings/afip \
  -H "Authorization: Bearer $GYM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cuit": "30-71234567-1",
    "puntoVenta": 4,
    "taxCondition": "MONOTRIBUTO",
    "isActive": true
  }'
```

```jsonc
// Response 200
{
  "status": "success",
  "data": {
    "cuit": "30-71234567-1",
    "afipConfig": {
      "puntoVenta": 4,
      "taxCondition": "MONOTRIBUTO",
      "isActive": true,
      "hasApiKey": false,          // false hasta el paso 2
      "hasCert": false,
      "hasKey": false,
      "credencialesActualizadasEn": null
    }
  }
}
```

| Campo | Validación | Si está mal |
|---|---|---|
| `cuit` | Mínimo 11 caracteres al guardar; **exactamente 11 dígitos** tras sacar guiones y puntos al emitir | `400` al guardar si es más corto. `409 A gym with this CUIT already exists` si otro gimnasio ya lo usa. Si tiene otra cantidad de dígitos, la factura queda en `error` con el detalle |
| `puntoVenta` | Entero positivo | `400` |
| `taxCondition` | Solo `MONOTRIBUTO` o `RESPONSABLE_INSCRIPTO` | `400`. **`EXENTO` ya no existe**: le discriminaba IVA a quien no debe |
| `isActive` | Booleano | Con `false`, la factura queda en `error`: *"La facturación AFIP no está activa para este gimnasio"* |

#### 2. Cargar la credencial propia — `PUT /api/gyms/settings/afip/credenciales`

**Multipart, no JSON.** `apiKey` como campo de texto, `cert` y `key` como archivos. Los tres
son opcionales entre sí —se puede rotar uno solo— pero hace falta mandar al menos uno.

```bash
curl -X PUT http://localhost:4000/api/gyms/settings/afip/credenciales \
  -H "Authorization: Bearer $GYM_TOKEN" \
  -F "apiKey=el-access-token-de-app.afipsdk.com" \
  -F "cert=@/ruta/al/certificado.crt" \
  -F "key=@/ruta/a/la/clave.key"
```

```jsonc
// Response 200
{
  "status": "success",
  "data": {
    "afipConfig": {
      "puntoVenta": 4,
      "taxCondition": "MONOTRIBUTO",
      "isActive": true,
      "hasApiKey": true,
      "hasCert": true,
      "hasKey": true,
      "credencialesActualizadasEn": "2026-08-20T18:30:00.000Z"
    }
  }
}
```

**Nunca devuelve el contenido cargado**, ni cifrado ni en claro — solo los `has*` y la
fecha. Si la pantalla necesita mostrar "credencial cargada el 20/08", es de acá.

| Error | Causa | Cómo se ve |
|---|---|---|
| `400` | No se mandó ninguno de los tres campos | `"Hay que enviar al menos una credencial (apiKey, cert o key)"` |
| `400` | El `.crt` no tiene forma de PEM (no contiene `BEGIN CERTIFICATE`) | `"El archivo .crt no tiene forma de certificado PEM..."` |
| `400` | El `.key` no tiene forma de PEM (no contiene `PRIVATE KEY`) | `"El archivo .key no tiene forma de clave privada PEM..."` |
| `400` | El gym todavía no configuró su identidad fiscal (paso 1) | `"El gimnasio todavía no tiene configurada su identidad fiscal..."` — hacer el paso 1 primero |
| `413` | Un archivo pasa los 64KB | Multer corta ahí a propósito: un `.crt`/`.key` real nunca se acerca a ese tamaño |

#### 3. Leer lo ya configurado — `GET /api/gyms/settings`

```jsonc
{
  "data": {
    "cuit": "30-71234567-1",        // ← en la RAÍZ, no dentro de afipConfig
    "afipConfig": {
      "puntoVenta": 4,
      "taxCondition": "MONOTRIBUTO",
      "isActive": true,
      "hasApiKey": true,
      "hasCert": true,
      "hasKey": true,
      "credencialesActualizadasEn": "2026-08-20T18:30:00.000Z"
    }
  }
}
```

⚠️ **`afipConfig` viene `undefined`** si el gimnasio nunca configuró nada. La pantalla
tiene que tolerarlo y mostrar el formulario vacío, no romperse. Con `hasApiKey`/`hasCert`/
`hasKey` en `false` se puede armar el badge "Facturación configurada pero sin credencial" —
un caso real: gimnasios que ya tenían identidad fiscal cargada de antes de este cambio.

#### 4. El socio: DNI, y CUIT si es Responsable Inscripto — `POST` / `PUT /api/clients`

`documento` ya es obligatorio en el alta, y para facturar como consumidor final tiene que
ser un **DNI de 7 u 8 dígitos** una vez sacados puntos y guiones. Los de 7 se aceptan a
propósito: hay documentos viejos así.

**Nuevo:** `condicionFiscal` (`"RESPONSABLE_INSCRIPTO"` | `"CONSUMIDOR_FINAL"`, opcional,
default `CONSUMIDOR_FINAL`) y `cuit` (obligatorio solo si `condicionFiscal` es
`RESPONSABLE_INSCRIPTO`, mínimo 11 caracteres).

```bash
# Socio consumidor final (el caso de siempre, no hace falta mandar condicionFiscal)
curl -X POST http://localhost:4000/api/clients \
  -H "Authorization: Bearer $GYM_TOKEN" -H "Content-Type: application/json" \
  -d '{ "nombre": "Juan Pérez", "documento": "34555666" }'

# Socio Responsable Inscripto (factura A)
curl -X PUT http://localhost:4000/api/clients/$CLIENT_ID \
  -H "Authorization: Bearer $GYM_TOKEN" -H "Content-Type: application/json" \
  -d '{ "condicionFiscal": "RESPONSABLE_INSCRIPTO", "cuit": "30711122238" }'
```

`400` — `"Un cliente Responsable Inscripto necesita un CUIT válido (11 dígitos)"` — si se
manda `condicionFiscal: "RESPONSABLE_INSCRIPTO"` sin `cuit` válido, tanto en el alta como en
la edición (evalúa el estado **final** del socio: lo que llega más lo que ya tenía).

#### Qué comprobante sale — depende de DOS condiciones fiscales

No solo de la del gimnasio: también de la del socio. Es lo más importante para armar los
guiones de prueba de abajo.

| Gym (`taxCondition`) | Socio (`condicionFiscal`) | Comprobante | IVA | Se factura a |
|---|---|---|---|---|
| `MONOTRIBUTO` | *(cualquiera)* | **Factura C** (código 11) | No se discrimina: neto = total | DNI del socio |
| `RESPONSABLE_INSCRIPTO` | `CONSUMIDOR_FINAL` (default) | **Factura B** (código 6) | Se desagrega del precio | DNI del socio |
| `RESPONSABLE_INSCRIPTO` | `RESPONSABLE_INSCRIPTO` | **Factura A** (código 1) | Se desagrega del precio | **CUIT del socio**, no su DNI |

Un gimnasio monotributista **siempre** emite Factura C, sin mirar al socio — no hace falta
(ni sirve) marcarlo como Responsable Inscripto para probar ese caso.

#### 5. Renovar dispara la factura — `POST /api/clients/:id/renew`

```bash
curl -X POST http://localhost:4000/api/clients/$CLIENT_ID/renew \
  -H "Authorization: Bearer $GYM_TOKEN" -H "Content-Type: application/json" \
  -d '{ "monto": 15000 }'
```

⚠️ **Lo más importante para el front: renovar NO factura en el momento.** La respuesta
llega enseguida; la factura queda en estado `pendiente`, ya con el `tipoComprobante` que le
corresponde según la tabla de arriba (es una vista previa — el que manda es el que confirme
AFIP al emitir). El comprobante lo emite el worker después. **No esperar un CAE en la
respuesta de la renovación.**

La UI tiene que reflejarlo: al renovar, mostrar "factura encolada"; el CAE aparece al
refrescar el historial.

#### 6. Disparar la emisión para el test — `POST /api/internal/jobs/emit-invoices`

**No lo llama el front** — lo consume un cron externo, y lleva el secreto de plataforma
`INVOICE_CRON_SECRET` en el header `x-internal-secret`. Para testear manualmente sin
esperar al worker interno (que tickea cada 15s en modo `interno`, el default), es el atajo
más rápido:

```bash
curl -X POST http://localhost:4000/api/internal/jobs/emit-invoices \
  -H "x-internal-secret: $INVOICE_CRON_SECRET"
```

```jsonc
// Response 200
{ "status": "success", "data": { "procesadas": 1, "emitidas": 1, "fallidas": 0, "truncado": false } }
```

Si `fallidas > 0`, el motivo está en `errorLog` de la factura (`GET /invoices`), no en esta
respuesta.

#### 7. Mostrar el historial — `GET /api/invoices`

Query params: `clientId`, `estado`, `tipoComprobante`, `cae`, `emitidaDesde`,
`emitidaHasta`, `page` (default 1), `limit` (default 20, **máximo 100**).

| Estado | Qué mostrar |
|---|---|
| `pendiente` | "En cola". Recién renovado, todavía no fue a ARCA |
| `emitida` | El comprobante real: `cae`, `vencimientoCae`, `numeroComprobante`, `puntoVenta`, `tipoComprobante` (ahora puede ser **A**, B o C), `neto`, `iva` |
| `error` | Falló. **Mostrar `errorLog`**: dice exactamente qué dato corregir |
| `anulada` | Existe en el dominio pero **nada lo produce todavía** — la nota de crédito está sin implementar |

También están `GET /api/invoices/:id` para el detalle y
`GET /api/invoices/revenue?desde=&hasta=` para el reporte de ingresos.

#### 8. Recuperar una factura fallida — `POST /api/invoices/:id/retry`

Solo desde estado `error`; reintentar una `emitida` la facturaría dos veces y el endpoint lo
rechaza con `400`. La devuelve a `pendiente` con el crédito de intentos completo.

**El flujo de recuperación que la pantalla tiene que permitir:** la factura falla → el
usuario lee `errorLog` → corrige el dato (CUIT/credenciales en la pantalla de facturación,
DNI o CUIT en la ficha del socio) → aprieta reintentar. **No hay que volver a renovar al
socio**, que le cobraría la cuota de nuevo.

Los fallos transitorios —ARCA caído, timeout— se reintentan solos con backoff, hasta 5
veces. El botón es para los de validación, que no se arreglan esperando.

---

#### Guiones de prueba — de punta a punta, los tres comprobantes

Mismos pasos que corre `tests/e2e/facturacionCuentaPropia.test.ts` contra un mock del SDK;
acá es contra AFIP SDK real (homologación con `AFIP_SDK_ENVIRONMENT=dev`, o dentro de la
app con la pantalla que construya el front). Variables usadas en los curl:
`$GYM_TOKEN` (login del dueño del gym), `$CLIENT_ID`, `$INVOICE_CRON_SECRET` (del `.env`).

**Guion A — Monotributo → Factura C**
1. `PUT /gyms/settings/afip` — `taxCondition: "MONOTRIBUTO"`, `isActive: true`.
2. `PUT /gyms/settings/afip/credenciales` — `apiKey` + `cert` + `key` reales de AFIP SDK.
3. `POST /clients` — un socio con `documento` de 7-8 dígitos, sin `condicionFiscal`.
4. `POST /clients/:id/renew` — `{ "monto": 15000 }`.
5. `GET /invoices` → el registro nuevo está `pendiente` con `tipoComprobante: "Factura C"`.
6. `POST /internal/jobs/emit-invoices` (o esperar 15s si el worker interno está prendido).
7. `GET /invoices` → `estado: "emitida"`, `cae` presente, `neto === monto`, `iva === 0`.

**Guion B — Responsable Inscripto + socio consumidor final → Factura B**
1. Igual que arriba pero `taxCondition: "RESPONSABLE_INSCRIPTO"`.
2. Cargar credenciales (paso 2).
3. Socio sin `condicionFiscal` (queda `CONSUMIDOR_FINAL` por default).
4. Renovar y emitir igual que arriba.
5. Verificar: `tipoComprobante: "Factura B"`, `neto + iva === monto` (al centavo), `iva > 0`.

**Guion C — Responsable Inscripto + socio Responsable Inscripto → Factura A**
*(El caso nuevo — no existía antes del 20-08, es el que más vale probar.)*
1. Gym `RESPONSABLE_INSCRIPTO` con credenciales cargadas (como en B).
2. `PUT /clients/:id` — `{ "condicionFiscal": "RESPONSABLE_INSCRIPTO", "cuit": "30711122238" }`.
3. Renovar: `GET /invoices` de la pendiente ya dice `tipoComprobante: "Factura A"`.
4. Emitir.
5. Verificar: `tipoComprobante: "Factura A"`, y que lo que se le mandó a AFIP fue el **CUIT**
   del socio (`30711122238`), no su DNI — eso solo se ve en el log de AFIP SDK o, en un test
   automatizado, interceptando la llamada (ver el e2e).

**Guion de error 1 — sin credenciales cargadas**
1. Configurar identidad fiscal (paso 1) pero **saltear** el paso 2.
2. Renovar → encola igual (la renovación nunca depende de la credencial).
3. Emitir → `fallidas: 1`.
4. `GET /invoices` → `estado: "error"`, `errorLog` menciona *"no cargó su certificado, clave
   privada o API key"*. **No reintenta sola** (es un error de configuración, no transitorio).

**Guion de error 2 — socio marcado RI sin CUIT válido**
1. `PUT /clients/:id` con `condicionFiscal: "RESPONSABLE_INSCRIPTO"` y `cuit` inválido (o
   ausente) → **`400` inmediato**, no llega a encolar nada mal.

#### Checklist mínimo para que una factura salga

1. `PUT /gyms/settings/afip` con `cuit`, `puntoVenta`, `taxCondition` e `isActive: true`
2. `PUT /gyms/settings/afip/credenciales` con `apiKey`, `cert` y `key`
3. El socio dado de alta con un `documento` de 7 u 8 dígitos (y `condicionFiscal`/`cuit` si
   corresponde Factura A)
4. `POST /clients/:id/renew` con el `monto`
5. Esperar al worker (o disparar `POST /internal/jobs/emit-invoices` a mano para testear)
6. `GET /invoices` para ver el CAE

Si falla alguno de los primeros cuatro, la factura queda en `error` con el motivo en
`errorLog` y se recupera con `retry`. Ninguno de esos errores se reintenta solo, porque
esperar no los arregla.

#### Lo que el front no tiene que llamar

`POST /api/internal/jobs/emit-invoices` es el disparador del worker y lleva un secreto de
plataforma (`x-internal-secret`). Lo consume un **cron externo**, no el navegador — usarlo
para testear a mano (guiones de arriba) está bien, pero no puede quedar expuesto en la UI:
si se filtra el secreto, cualquiera dispara emisiones de facturas reales.

### F2 — Vencimiento de rutinas: textos y contadores

**Es trabajo del front. El backend ya está.** Detalle completo del cambio en
[§2 quinquies.4](#4-el-vencimiento-de-las-rutinas-era-el-de-la-cuota-).

`routine.fechaVencimiento` **cambió de significado**: era el vencimiento de la cuota del
socio, ahora es la vigencia del plan de entrenamiento —30 días desde que se generó—. El
campo, su tipo y su lugar en el JSON no cambiaron, así que **nada rompe**, pero lo que hay
alrededor puede haber quedado mintiendo.

| Dónde | Qué revisar |
|---|---|
| Listado de rutinas | Cualquier texto que diga "vence la membresía" o similar al lado de `fechaVencimiento`. Ahora es la rutina la que vence |
| Tarjeta "rutinas por vencer" del dashboard | `rutinasPorVencer.{en7Dias, en5Dias, en3Dias}` ahora **acumula**: los tres se anidan (`en3 ⊆ en5 ⊆ en7`) y los números van a subir. Si la UI los sumaba entre sí, estaría contando de más |
| `GET /routines/expiring?days=N` | Pasó de "vencen el día N exacto" a "vencen dentro de N días" |

**Los dos vencimientos conviven y son distintos.** Si la pantalla muestra los dos, hay que
distinguirlos: `client.fechaVencimiento` es hasta cuándo pagó, `routine.fechaVencimiento` es
hasta cuándo le sirve el plan. Un socio que renueva a mitad de mes sigue con la misma rutina
hasta que esta se venza.

⚠️ **Hasta que no se corra `npm run backfill:vencimiento-rutinas`** ([§0.1](#01-correr-los-dos-scripts-contra-la-base-)),
las rutinas ya generadas siguen mostrando la fecha vieja. Probar la pantalla contra datos
sin migrar lleva a conclusiones equivocadas.

### F3 — Pantalla de Mercado Pago: conectar, catálogo y botón de renovación

**Es trabajo del front. El backend está listo, probado de punta a punta (unit + e2e,
`tests/e2e/renovacionMercadoPago.test.ts`) y esta sección es también la guía de testing.**
Contrato completo, con ejemplos, en
[`docs/API_ENDPOINTS.md` §5, §5 bis y §6](docs/API_ENDPOINTS.md).

Sin esta pantalla no se puede cobrar por Mercado Pago: la conexión de la cuenta, el
catálogo de precios y el botón de renovación solo se pueden cargar/disparar desde acá.

#### Lo que hace falta armar

| Pieza | Dónde pega | Detalle |
|---|---|---|
| Botón "Conectar con Mercado Pago" | Configuración del gym | **GET autenticado** (fetch/axios) a `GET /gyms/settings/mercadopago/connect` → `{ url }`, y recién con esa URL en la mano, `window.open(url)` (ver ⚠️ abajo) |
| Estado de conexión | Configuración del gym | `GET /gyms/settings` → `mercadoPagoConfig: { conectado, conectadoEn }` |
| Botón "Desconectar" | Configuración del gym | `DELETE /gyms/settings/mercadopago` |
| Catálogo de planes (CRUD de los 4 tipos) | Configuración del gym | `PUT /gyms/settings/membership-plans` — reemplaza la lista completa |
| Botón **Renovación** en la ficha del socio | Ficha de cliente | Elegir plan → elegir método: **Efectivo** (`POST /clients/:id/renew` con `tipoPlan`, aplica al instante) o **Mercado Pago** (`POST /clients/:id/renewal-requests`, queda pendiente hasta el webhook) |
| Badge "Renovación Pendiente (Plan)" | Listado/ficha de clientes | `GET /clients/:id/renewal-requests?estado=pendiente` — **no** es un campo de `Client` |

⚠️ **`GET /gyms/settings/mercadopago/connect` devuelve JSON, no redirige.** Corregido
el 21-08 tras detectarlo desde el front: la ruta está detrás de `authMiddleware` como el
resto de `/gyms/settings/*`, y una navegación real de browser (`<a href>`,
`window.location`, `window.open`) **no puede llevar el header `Authorization: Bearer`** —
eso solo lo hace un `fetch`/axios. El flujo correcto:

1. GET autenticado normal → `{ "data": { "url": "https://auth.mercadopago.com/..." } }`.
2. El front navega él mismo con esa URL (`window.open(url)` es lo recomendado, para no
   perder la pestaña del CRM — el dueño vuelve a una pestaña nueva que cae en el callback).
3. Cuando el dueño vuelve, cae en `GET /mercadopago/callback` (público, lo maneja el
   backend solo) — el front no participa de ese paso, solo tiene que enterarse de que ya
   terminó (pollear `GET /gyms/settings`, o pedirle al dueño que refresque la pestaña
   original).

#### 1. Conectar la cuenta

```bash
curl http://localhost:4000/api/gyms/settings/mercadopago/connect \
  -H "Authorization: Bearer $GYM_TOKEN"
```

```jsonc
// Response 200
{ "status": "success", "data": { "url": "https://auth.mercadopago.com/authorization?..." } }
```

Si la plataforma no tiene `MERCADOPAGO_CLIENT_ID`/`CLIENT_SECRET`/`REDIRECT_URI` cargadas
(ver [§0.4](#04-probar-mercado-pago-contra-una-cuenta-de-test-real-)), responde `400` en
vez de la `url`.

#### 2. Configurar el catálogo — `PUT /api/gyms/settings/membership-plans`

```bash
curl -X PUT http://localhost:4000/api/gyms/settings/membership-plans \
  -H "Authorization: Bearer $GYM_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "planes": [
      { "tipo": "mensual", "duracionDias": 30, "monto": 15000, "activo": true },
      { "tipo": "semestral", "duracionDias": 180, "monto": 70000, "activo": true }
    ]
  }'
```

No hace falta cargar los cuatro tipos — los que falten simplemente no aparecen como
opción al elegir plan. `400` si hay dos planes con el mismo `tipo`, o algún
`monto`/`duracionDias` no positivo.

#### 3. Cobrar en efectivo, en el momento — `POST /api/clients/:id/renew`

```bash
curl -X POST http://localhost:4000/api/clients/$CLIENT_ID/renew \
  -H "Authorization: Bearer $GYM_TOKEN" -H "Content-Type: application/json" \
  -d '{ "tipoPlan": "mensual" }'
```

Renueva al instante (sin esperar nada) y **cancela cualquier link de Mercado Pago
pendiente** que tuviera este socio — la UI tiene que reflejar eso: si había un badge de
"link pendiente", desaparece.

#### 4. Cobrar por Mercado Pago — `POST /api/clients/:id/renewal-requests`

```bash
curl -X POST http://localhost:4000/api/clients/$CLIENT_ID/renewal-requests \
  -H "Authorization: Bearer $GYM_TOKEN" -H "Content-Type: application/json" \
  -d '{ "tipoPlan": "mensual" }'
```

```jsonc
// Response 201
{ "status": "success", "data": {
  "id": "...", "estado": "pendiente", "initPoint": "https://www.mercadopago.com.ar/...",
  "plan": { "tipo": "mensual", "duracionDias": 30, "monto": 15000 }
} }
```

⚠️ **No renueva en el momento.** El link se manda solo por WhatsApp si el socio tiene
`telefono` cargado; si no, o si falla el envío, el link igual queda válido — mostrarlo en
pantalla para que se pueda copiar a mano es un buen respaldo.

#### 5. Confirmar el pago para el test — el webhook, sin cuenta real todavía

Sin una cuenta de Mercado Pago conectada de verdad ([§0.4](#04-probar-mercado-pago-contra-una-cuenta-de-test-real-)),
no hay forma de que el pago se confirme solo. El e2e (`tests/e2e/renovacionMercadoPago.test.ts`)
simula el webhook firmándolo a mano con `MERCADOPAGO_WEBHOOK_SECRET` — es el mismo camino
que seguiría un test manual una vez que haya credenciales reales cargadas.

#### 6. Leer el historial — `GET /api/clients/:id/renewal-requests`

| Estado | Qué mostrar |
|---|---|
| `pendiente` | "Esperando pago" — el link sigue siendo válido, se puede reenviar o cancelar con un cobro en efectivo |
| `aprobado` | El socio ya está renovado (revisar `GET /clients/:id` para la fecha real) |
| `rechazado` | El pago no se completó — se puede pedir un link nuevo |
| `cancelado` | Lo reemplazó un pedido más nuevo, o se confirmó un cobro en efectivo mientras estaba pendiente |

#### Checklist mínimo para que un cobro por Mercado Pago salga

1. `GET /gyms/settings/mercadopago/connect` (conectar, una sola vez)
2. `PUT /gyms/settings/membership-plans` con al menos un plan activo
3. El socio con `telefono` cargado (si no, el link no se manda solo)
4. `POST /clients/:id/renewal-requests` con el `tipoPlan`
5. Esperar el webhook (o confirmarlo a mano contra homologación una vez que haya cuenta
   de test, [§0.4](#04-probar-mercado-pago-contra-una-cuenta-de-test-real-))
6. `GET /clients/:id` para ver la renovación aplicada

### P3-B — Embudo en la serie mensual

**No está pedido y no está abierto.** Queda anotado con el porqué, para no volver a
pensarlo desde cero.

`/dashboard/kpis/series` hace una sola lectura para los doce meses. El embudo sale de
`getLeadCohort` y `countConversions` (`GetGymKpisUseCase.ts:164-165`), que hoy reciben
**un** rango (`IMetricsRepository.ts:115,127`): agregarlo a la serie serían doce
consultas más, o un rediseño del puerto para que devuelva la cohorte de doce meses y se
particione en memoria.

Si alguna vez se pide, **la forma correcta es la segunda** —una lectura, partición en
memoria— para no romper la regla de la lectura única. La primera es más fácil de escribir
y le saca al endpoint la única razón por la que existe.

---

## 2 novies. Hecho el 22-08 — Mercado Pago sin OAuth, credencial directa por gym ✅

821 tests (eran 813 al arrancar la tanda; 821 en verde, `tsc --noEmit` y `npm run typecheck`
limpios salvo un error preexistente y sin relación en
`tests/unit/gym/UpdateMembershipPlansUseCase.test.ts`, anotado, no de esta tanda).

**Pedido del usuario:** que cada gimnasio cargue su propia credencial de Mercado Pago "al
igual que los datos de facturación y las credenciales de WhatsApp" — sin depender de una
app de plataforma ni de un flujo OAuth con popup. Se reemplazó el diseño de
[§2 septies](#2-septies-hecho-el-21-08--pasarela-de-pago-con-mercado-pago-) por completo,
sin dejar un modo viejo desconectado (a diferencia de `AFIP_BILLING_MODE`): como ningún gym
real había conectado una cuenta todavía, no hubo nada que migrar.

### 1. Por qué el diseño anterior ya mandaba la plata a la cuenta correcta, y por qué se cambió igual

El OAuth (`client_id`/`client_secret` de plataforma + cada gym autorizando su propia
cuenta) **ya hacía que el dinero fuera a la cuenta del gym**, no a la de la plataforma — el
`client_id` de plataforma es solo "qué app pide permiso", como "Iniciar sesión con Google".
Pero traía tres costos que el modelo directo no tiene:

- Necesitaba una **app de tipo Marketplace aprobada** por Mercado Pago.
- Necesitaba un **dominio público estable** para el `redirect_uri` — bloqueado por D1,
  igual que la cookie de sesión.
- Obligaba a un **popup de login dentro de la app** para algo que el dueño puede resolver
  solo, pegando dos valores, como ya hace con AFIP.

Investigado antes de decidir (no asumido): el secreto de firma del webhook de Mercado Pago
es **por integración/aplicación**, no por cuenta compartida — cada cuenta que genera
credenciales tiene la suya en "Tus integraciones". Esto es lo que habilita el modelo directo:
cada gym, al cargar su Access Token, también tiene su propio secreto de webhook para
configurar. Y el Access Token de producción **no vence por tiempo** (a diferencia del OAuth,
que vencía a los 180 días) — se regenera manualmente desde el panel del dueño, así que no
hace falta refresh token ni una tarea de refresco.

### 2. Qué cambió en el dominio ✅

`Gym.mercadoPagoConfig` pasó de `{ encryptedAccessToken, encryptedRefreshToken, mpUserId,
expiraEn, conectadoEn }` a `{ encryptedAccessToken, encryptedWebhookSecret, mpUserId,
credencialesActualizadasEn }` — mismo nombre de campo (`credencialesActualizadasEn`) que
`afipConfig`, a propósito.

`mpUserId` **no lo tipea el dueño**: `UpdateMercadoPagoCredentialsUseCase` llama a
`GET /users/me` de Mercado Pago con el `accessToken` que mandó (nuevo método
`IPaymentProvider.obtenerCuenta()`) y captura el `id` de esa respuesta. De paso, esa
llamada valida que el token realmente sirve — si Mercado Pago responde `401`, el caso de
uso lanza y no se guarda nada, en vez de descubrirlo recién al intentar cobrar el primer
link.

### 3. Qué se borró, sin reemplazo ni modo desconectado ✅

- `IMercadoPagoOAuthService` (puerto) y `MercadoPagoOAuthAdapter` (adaptador).
- `ResolverMercadoPagoAccessTokenUseCase` (ya no hace falta refrescar nada) y
  `HandleMercadoPagoCallbackUseCase`.
- `GET /gyms/settings/mercadopago/connect` y `GET /mercadopago/callback`.
- `MERCADOPAGO_CLIENT_ID`/`CLIENT_SECRET`/`REDIRECT_URI`/`WEBHOOK_SECRET` de `env.ts` y
  `.env.example` — **cero variables de entorno** para Mercado Pago, igual que AFIP en modo
  `cuenta_propia`.

### 4. El webhook ahora resuelve el gym ANTES de verificar la firma ✅

Antes: un secreto único de plataforma verificaba cualquier webhook, sin importar de qué
gym. Ahora cada gym tiene su propio secreto, así que hay que saber primero A CUÁL antes de
poder verificar nada. `POST /mercadopago/webhook` (`mercadopago.routes.ts`) resuelve en
este orden: busca el gym por el `user_id` del body (no verificado todavía) →
si no hay secreto cargado, `503` → si la firma no calza contra el secreto de ESE gym,
`401` → si no hay `accessToken` cargado, `503` → recién ahí llama al caso de uso.

**Es seguro aunque el `user_id` no esté verificado en ese primer paso**: un atacante que lo
adivine (o copie de un gym real) igual necesita producir un HMAC válido con un secreto que
no tiene. Mismo modelo de confianza que webhooks multi-tenant de otros proveedores (Stripe
Connect y similares), aplicado acá.

`ProcessMercadoPagoWebhookUseCase` se simplificó: ya no depende de `IGymRepository` ni de
un resolver de token — recibe `gymId` y `accessToken` ya resueltos por la ruta, porque
encontrar el gym y verificar la firma son responsabilidades de borde (mapean a
200/503/401 distintos), no de este caso de uso.

### 5. Documentación actualizada ✅

`docs/API_ENDPOINTS.md` §5 (`PUT /gyms/settings/mercadopago/credenciales` reemplaza a
`connect`) y §5 bis (webhook: orden de validación gym-primero). Este documento, sección
[§0.4](#04-probar-mercado-pago-contra-una-cuenta-real-), que sigue siendo la guía de qué
falta probar — más corta que antes: ya no hace falta registrar nada en Mercado Pago
Developers a nivel plataforma.

### 6. El front también se puso al día ✅

Sesión hermana (`front-9f`), mismo día: `MercadoPagoConnectCard.tsx` (el botón + popup)
se reemplazó por un formulario de dos campos (`accessToken`/`webhookSecret`), mismo patrón
que `AfipCredentialsForm.tsx`. Verificado: `tsc -b` limpio, tests del front en verde.

---

## 2 octies. Hecho el 21-08 (frontend) — F1, F2 y F3 implementadas y verificadas en vivo ✅

Cierra el tablero: las tres pantallas que este documento pedía —facturación, vencimiento
de rutinas, Mercado Pago— están escritas, tipeadas, con tests unitarios y **probadas en
vivo contra este backend corriendo en local**, no solo contra mocks. Sesión de front
separada de la que hizo el backend (§2 septies, mismo día), coordinada por el mismo
usuario para cerrar el mismatch del contrato de "Conectar con Mercado Pago" (punto 3 de
esta sección).

### 1. F1 — Facturación AFIP ✅

La identidad fiscal (CUIT, punto de venta, condición, `isActive`) ya existía de una tanda
anterior del front. Lo que faltaba y se agregó ahora:

- **Credencial propia de AFIP SDK** (`apiKey` + `.crt` + `.key`, multipart), con el mismo
  patrón "write-only" que ya usaba la credencial de IA: el campo arranca vacío siempre, y
  solo viaja si se cargó algo nuevo.
- El checklist de "qué falta para emitir" sumó un quinto requisito (la credencial) —
  hasta ahora decía "puede emitir" con la identidad fiscal completa pero sin credencial
  cargada, que es justo el caso que dejó el revert del 20-08 (§2 sexies).
- `condicionFiscal`/`cuit` del socio en el alta y la edición, con el campo de CUIT
  apareciendo solo si se elige Responsable Inscripto — habilita probar Factura A desde la
  UI y no solo por curl.

**Probado en vivo:** se guardó una credencial de prueba contra este backend, el checklist
reaccionó marcando "Credencial de AFIP SDK" como faltante hasta completar los tres
campos, y se armó un socio Responsable Inscripto de punta a punta (con su badge en la
ficha).

### 2. F2 — Vencimiento de rutinas ✅

Se auditó y **no hizo falta ningún cambio**: el dashboard ya mostraba los tres
contadores (`en7Dias`/`en5Dias`/`en3Dias`) sin sumarlos entre sí, y los textos ya
distinguían el vencimiento de la rutina del de la membresía. Queda documentado acá para
no volver a auditarlo de cero en una próxima sesión.

### 3. F3 — Mercado Pago ✅

Todo nuevo: catálogo de planes, conectar/desconectar cuenta, y el diálogo de renovación
con los dos métodos de cobro.

- **Catálogo de planes**: los cuatro tipos fijos (mensual/trimestral/semestral/anual),
  cada uno con duración/monto/activo. Se manda al backend solo el tipo que tenga los dos
  campos completos y positivos — no hace falta una fila dinámica para "no cargar los
  cuatro tipos", alcanza con filtrar al enviar.
- **Conectar/desconectar Mercado Pago**: acá apareció el problema real de contrato. El
  access token de este front vive **solo en memoria** (nunca en cookie), así que una
  navegación de browser real (`<a href>`, `window.open`, `window.location`) no puede
  llevar el header `Authorization: Bearer` que pedía (y sigue pidiendo) `authMiddleware`.
  Seguir el `302` tal como estaba documentado daba `401` en la práctica. Se corrigió el
  mismo día cambiando el endpoint a devolver `{ data: { url } }` (ver
  [§2 septies](#2-septies-hecho-el-21-08--pasarela-de-pago-con-mercado-pago-) y
  `docs/API_ENDPOINTS.md` §5) — el front pide la URL con un GET autenticado normal y
  recién con la respuesta en la mano hace `window.open`.
- **Diálogo de renovación, rediseñado**: elegir qué cobrar (plan del catálogo o monto
  manual) y elegir método (efectivo al instante, o Mercado Pago — solo si hay un plan de
  catálogo elegido **y** la cuenta está conectada). El resultado se muestra distinto según
  el método: una fecha nueva para efectivo, un link "esperando pago" para Mercado Pago.
- **Historial de links + badge "Renovación Pendiente"** en la ficha del socio, leyendo
  `GET /clients/:id/renewal-requests`. **Decisión tomada con el usuario:** el badge no se
  agregó al listado paginado de socios — no hay un endpoint que traiga de una sola vez
  qué socios tienen un link pendiente para todo el gimnasio, y agregarlo ahí exigiría una
  consulta por fila (patrón que no existe en ningún otro listado del sistema). Si hace
  falta más adelante, es un pedido de endpoint agregado al backend (un
  `GET /renewal-requests?estado=pendiente` a nivel gimnasio, análogo a como `/routines` y
  `/invoices` resuelven el listado del gimnasio entero), no algo que el front deba resolver
  con N+1.

**Probado en vivo, con datos reales de este backend:**

- El catálogo se guardó y persistió tras recargar la página (`mensual` activo a $18.000).
- El botón "Conectar" hizo el GET autenticado real y recibió el `400` esperado —las
  credenciales de plataforma
  (`MERCADOPAGO_CLIENT_ID`/`CLIENT_SECRET`/`REDIRECT_URI`,
  [§0.4](#04-probar-mercado-pago-contra-una-cuenta-de-test-real-)) todavía no están
  cargadas en ningún `.env`, así que esto es lo correcto y no un bug nuevo.
- Se renovó a un socio real por catálogo (`{ "tipoPlan": "mensual" }`): el vencimiento
  pasó de `26/08/2026` a `25/09/2026`, confirmando en vivo que el camino por catálogo
  extiende desde el vencimiento **actual** del socio — a diferencia del monto manual, que
  extiende siempre desde hoy (`docs/API_ENDPOINTS.md` §6).
- **Lo único que no se pudo probar en vivo** es el circuito completo de un link pagado de
  verdad (`POST /clients/:id/renewal-requests` → pago → webhook → `aprobado`), porque la
  cuenta de Mercado Pago todavía no está conectada. Es exactamente el pendiente de
  [§0.4](#04-probar-mercado-pago-contra-una-cuenta-de-test-real-)/S2, no un hueco nuevo que
  haya dejado el front.

⚠️ **Efecto real en los datos de esta base, no un bug:** las pruebas en vivo activaron el
plan `mensual` ($18.000) en el catálogo del gimnasio de prueba y renovaron de verdad a un
socio real (vencimiento y evento de renovación quedaron aplicados, con su factura
correspondiente encolada si la facturación estaba activa). No hay endpoint para deshacer
una renovación — si molesta para los números de este gimnasio de prueba, se corrige a
mano contra Mongo.

### 4. Qué queda — es exactamente lo que ya estaba anotado, nada nuevo

[S1](#01-correr-los-dos-scripts-contra-la-base-) (correr los dos scripts),
[0.2](#02-probar-la-facturación-contra-el-homologación-de-arca-) (AFIP contra
homologación real) y [0.4](#04-probar-mercado-pago-contra-una-cuenta-de-test-real-)/S2
(Mercado Pago contra una cuenta de test real) — las tres son configuración y pruebas
manuales, no código. El front terminó su parte y queda a la espera de esas tres.

---

## 2 septies. Hecho el 21-08 — pasarela de pago con Mercado Pago ✅

813 tests (eran 803 al arrancar la tanda; 812 en verde — el único rojo sigue siendo el
mismo de rutinas con fecha hardcodeada, no relacionado), `tsc --noEmit` y `npm run build`
limpios.

Cierra el paso que quedaba antes de la facturación: cobrar de verdad. Hasta ahora
`POST /clients/:id/renew` confiaba en que el operador ya había cobrado en efectivo; ahora
hay un segundo camino —el link de Mercado Pago— que solo se confirma cuando Mercado Pago
avisa por webhook, y los dos caminos convergen en el mismo lugar para no duplicar la
lógica de churn/MRR/facturación.

### 1. Cómo queda el flujo completo ✅

```
[Operador elige plan] → [CRM crea el link] → [Socio paga]
                                                    ↓
[Factura AFIP encolada] ← [CRM aplica la renovación] ← [Mercado Pago confirma por webhook]
```

En paralelo, el cobro en efectivo/transferencia (`POST /clients/:id/renew`) ahora también
puede elegir `tipoPlan` en vez de tipear el monto a mano, y **cancela cualquier link de
Mercado Pago pendiente** al confirmarse — para que un socio no pueda terminar pagando la
misma cuota dos veces.

### 2. Cuenta PROPIA por gimnasio, mismo criterio que AFIP ✅

Cada gym conecta **su propia cuenta** de Mercado Pago por OAuth (no hay cuenta compartida
de plataforma): access token + refresh token, cifrados en `Gym.mercadoPagoConfig` con el
mismo AES-256-GCM que `afipConfig`/`whatsappConfig`. La plataforma solo aporta la
**aplicación** registrada en Mercado Pago Developers (`MERCADOPAGO_CLIENT_ID`/
`CLIENT_SECRET`/`REDIRECT_URI`) — el mismo rol que cumple `app.afipsdk.com` para AFIP SDK.

A diferencia del access token de AFIP SDK (no vence), el de Mercado Pago vence a los 180
días. `ResolverMercadoPagoAccessTokenUseCase` lo refresca solo, de forma perezosa, antes de
cada llamada que lo necesite — no hay un cron adicional.

### 3. El catálogo de precios, decisión explícita del usuario ✅

El monto de cada renovación (mensual/trimestral/semestral/anual) sale de
`Gym.membershipPlans`, un catálogo que carga el propio dueño — **no** se tipea a mano en
cada renovación, ni por el operador ni por el link de Mercado Pago. Fue una decisión
tomada expresamente frente a la alternativa de "monto libre + plan que solo define la
duración": el catálogo evita que dos operadores cobren distinto por el mismo plan, y hace
que el link y la factura salgan siempre con el monto exacto.

### 4. La renovación real vive en un único lugar, compartido por los dos caminos ✅

`RenewClientUseCase` (cobro manual) se partió en un wrapper delgado que resuelve
monto/vencimiento (por catálogo o a mano) y un núcleo nuevo, `AplicarRenovacionUseCase`
(`src/application/use-cases/client/AplicarRenovacionUseCase.ts`), que es literalmente el
cuerpo que antes tenía `RenewClientUseCase` entero: actualizar el cliente, dejar el evento
de membership y encolar la factura. `ProcessMercadoPagoWebhookUseCase` (la confirmación
por Mercado Pago) llama al mismo núcleo. Que los dos caminos conviertan sobre el mismo
código es lo que garantiza que el churn, el MRR y la facturación no puedan divergir según
por dónde entró el cobro.

### 5. El webhook nunca confía en su propio body ✅

La notificación de Mercado Pago (`{ type: "payment", data: { id }, user_id }`) solo trae un
`id` de pago y el `user_id` del vendedor conectado — **nunca** el resultado del pago en
claro. `ProcessMercadoPagoWebhookUseCase` usa el `user_id` para encontrar el gym
(`Gym.mercadoPagoConfig.mpUserId`, guardado al conectar) y con la cuenta de ESE gym vuelve
a pedirle el pago real a la API de Mercado Pago antes de tocar nada. Además:

- **Firma verificada** (`x-signature`/`x-request-id`, HMAC-SHA256 contra
  `MERCADOPAGO_WEBHOOK_SECRET`) con comparación en tiempo constante — mismo criterio que
  `internalAuthMiddleware`. Sin el secreto configurado, el endpoint responde `503`: cerrado
  por default, no abierto.
- **Idempotente**: un pedido que ya no está `pendiente` no se vuelve a aplicar, así que un
  reenvío de Mercado Pago (que hace seguido) no duplica la renovación.
- **Nunca toca al `Client`** hasta que el pago está `approved` de verdad.

⚠️ El manifest exacto del HMAC (`id:{data.id};request-id:{x-request-id};ts:{ts};`) sale de
las guías públicas de Mercado Pago, no de un webhook real verificado — ver
[§0.4](#04-probar-mercado-pago-contra-una-cuenta-de-test-real-).

### 6. `Client` no se tocó — el "pendiente" se deriva, no se guarda ✅

Se evaluaron dos formas de mostrar "Renovación Pendiente (Plan)" en el listado: agregar un
campo a `Client`, o derivarlo consultando `RenewalRequest`. Se eligió la segunda **a
propósito**: los KPIs de churn/MRR ya dependen de `ClientStatus`
(`activo|inactivo|pendiente`), y tocar ese enum o agregarle un campo relacionado arriesgaba
esos cálculos por una necesidad puramente de UI. `GET /clients/:id/renewal-requests` es de
donde sale el badge.

### 7. Probado con las mismas tres capas que la facturación AFIP ✅

- `tests/unit/payments/` — `ProcessMercadoPagoWebhookUseCase` (aprobado, rechazado,
  pendiente, idempotencia, gym no encontrado, pedido de otro gym), `mercadoPagoSignature`
  (firma válida/inválida/adulterada), `CreateRenewalPaymentLinkUseCase`.
- `tests/unit/client/RenewClientUseCase.test.ts` — ampliado con los casos de `tipoPlan` y
  la cancelación del link pendiente.
- `tests/unit/gym/UpdateMembershipPlansUseCase.test.ts`, `tests/unit/billing/planesMembresia.test.ts`.
- `tests/e2e/renovacionMercadoPago.test.ts` — el circuito HTTP completo con `axios`
  mockeado (no los puertos, mismo criterio que `facturacionArca.test.ts`): conectar por
  OAuth real → catálogo → pedir link → webhook firmado de verdad → cliente renovado +
  factura encolada, más firma inválida, reenvío idempotente y cobro en efectivo cancelando
  un link pendiente.

### 8. Documentación actualizada ✅

`docs/API_ENDPOINTS.md` (§5 Mercado Pago en gimnasio propio, §5 bis callback/webhook
público, §6 `renew`/`renewal-requests`) y este documento, sección
[F3](#f3--pantalla-de-mercado-pago-conectar-catálogo-y-botón-de-renovación), que es también
la guía de testing.

---

## 2 sexies. Hecho el 20-08 — vuelta a cuenta propia, Factura A y credenciales por gym ✅

777 tests (eran 769 al arrancar la tanda; 776 en verde — el único rojo es de rutinas con
fecha hardcodeada, `GetGymDashboardUseCase`/`GenerateRoutineUseCase.test.ts:266`, no
relacionado), `tsc --noEmit` y `npm run build` limpios.

**Se revirtió la cuenta única del 19-08 sin esperar la confirmación del proveedor** —el
usuario decidió no bloquearse en esa incógnita— y de paso se agregó lo que el modelo viejo
no soportaba: Factura A.

### 1. Cuenta propia por gimnasio, de vuelta ✅

Cada gym vuelve a facturar contra **su propia cuenta** de AFIP SDK: access token + `.crt` +
`.key`, cifrados en `Gym.afipConfig` con el mismo AES-256-GCM que `aiConfig`/
`whatsappConfig`. Se cargan por el endpoint nuevo, `PUT /gyms/settings/afip/credenciales`
(multipart — ver [F1 paso 2](#2-cargar-la-credencial-propia--put-apigymssettingsafipcredenciales)).

**El modo de cuenta única no se borró.** Quedó desconectado detrás de
`AFIP_BILLING_MODE` (`cuenta_propia` | `cuenta_unica`, default `cuenta_propia`):
`AfipSdkAdapter`/`AfipSdkAdapterFactory` y su e2e (`facturacionArca.test.ts`) siguen
intactos y corriendo, por si el día de mañana se confirma que el plan de AFIP SDK soporta
varios CUIT y se retoma. La pregunta de [§2 quinquies](#2-quinquies-hecho-el-19-08--cuenta-única-de-afip-y-vencimiento-de-rutinas-)
sigue sin responder, ahora sin urgencia.

### 2. El adaptador real, no el inventado ✅

El adaptador legacy le pegaba a un REST propio (`/v1/facturas`, snake_case) que **nunca se
verificó contra la doc real** de AFIP SDK. Esta vez se leyó el código fuente publicado de
`@afipsdk/afip.js@1.2.3` (no solo su documentación, incompleta en varios puntos) para
confirmar el contrato real: el paquete arma la autenticación WSAA (`Auth.Token`/`Sign`) por
su cuenta —contra `v1/afip/auth`, usando `cert`/`key`/`access_token`— y expone
`afip.ElectronicBilling.createNextVoucher(data)`, que además resuelve la numeración
correlativa contra AFIP en vivo (`FECompUltimoAutorizado` + `FECAESolicitar`). El adaptador
nuevo (`AfipSdkOwnAccountAdapter.ts`) no lleva contador local.

`data` es el contrato WSFE real: `Concepto`, `DocTipo`, `DocNro`, `CbteTipo`, `PtoVta`,
`ImpNeto`, `ImpIVA`, `CondicionIVAReceptorId` y `Iva: [{Id, BaseImp, Importe}]` (ausente en
Factura C, que no discrimina).

### 3. Factura A, el caso que no existía ✅

Antes el socio **siempre** facturaba como consumidor final. Ahora `Client` tiene
`condicionFiscal` (`RESPONSABLE_INSCRIPTO | CONSUMIDOR_FINAL`, default consumidor final) y
`cuit`, y `domain/billing/types.resolverComprobante(gymCondition, clientCondition)` es la
única fuente de verdad — tabla completa en
[F1](#qué-comprobante-sale--depende-de-dos-condiciones-fiscales). Un socio Responsable
Inscripto factura a su **propio CUIT** (`DocTipo: 80`), no a su DNI.

`CondicionIVAReceptorId` (campo obligatorio de AFIP desde la RG 5616, no existía en el
adaptador viejo) se verificó contra la tabla real de `FEParamGetCondicionIvaReceptor`: `1`
(Responsable Inscripto) es válido para comprobante clase A y `5` (Consumidor Final) para B
y C — el mapeo usado (RI→1, cualquier otro caso→5) es consistente con esa tabla, no una
suposición.

### 4. Trampa encontrada al implementar: allowlist explícito en el repositorio ✅

`MongoClientRepository.create`/`update` enumeran los campos a mano en vez de spread. Agregar
`condicionFiscal`/`cuit` al dominio, al schema y al validador **no alcanzaba** — se perdían
en silencio al guardar, sin error. Mismo patrón a vigilar si se agrega otro campo a `Client`
o `Gym` más adelante: el punto de falla no es el dominio, es el repositorio Mongo.

### 5. Probado con tres capas de test, no solo el e2e ✅

- `tests/unit/billing/AfipSdkOwnAccountAdapter.test.ts` — el payload WSFE exacto para A, B
  y C, y la clasificación de errores (`AfipWebServiceError` del SDK vs. HTTP 4xx/5xx vs. red).
- `tests/unit/invoice/EmitPendingInvoicesUseCase.test.ts` — los dos modos (`cuenta_propia`
  por default, `cuenta_unica` forzando `env.AFIP_BILLING_MODE` en el test).
- `tests/e2e/facturacionCuentaPropia.test.ts` — el circuito HTTP completo: multipart de
  credenciales → cifrado → renovar → emitir → historial, para los tres comprobantes más dos
  casos de error (sin credenciales, CUIT de socio RI inválido) y dos gyms facturando en la
  misma corrida cada uno con su propio access token.
- `tests/e2e/facturacionArca.test.ts` se mantiene, ahora fijando `AFIP_BILLING_MODE=cuenta_unica`
  al principio del archivo (antes del import dinámico de `config/env`, que se parsea una
  sola vez) para seguir siendo la red de regresión del modo desconectado.

### 6. Documentación actualizada ✅

`docs/API_ENDPOINTS.md` (secciones de gym-settings, clientes y facturación) y este
documento, sección [F1](#f1--pantalla-de-facturación-qué-tiene-que-cargar-el-gimnasio), que
ahora es también la guía de testing con curl de ejemplo y guiones paso a paso para los tres
comprobantes.

⚠️ **Nota operativa, sin acción de código:** los gimnasios que ya facturaban bajo cuenta
única no tienen credencial propia guardada (se purgó en la migración del 19-08,
`scripts/purge-afip-gym-keys.ts`). Sus próximas facturas quedan en `error` hasta que carguen
su `apiKey`/`cert`/`key` por el endpoint nuevo. Es esperable, no un bug — ver el "Guion de
error 1" de F1.

---

## 2 quinquies. Hecho el 19-08 — cuenta única de AFIP y vencimiento de rutinas ✅

755 tests (eran 738), `tsc` limpio.

Se cerró una ambigüedad que habría aparecido recién en producción: **quién es el titular de
la cuenta de AFIP SDK.**

### 1. La credencial por gimnasio, eliminada ✅

`afipConfig` guardaba una `encryptedApiKey` por gimnasio y **ganaba sobre la de la
plataforma**. Eso mezclaba dos cosas distintas: la **cuenta con el proveedor del SDK**, que
se paga y se cuotea una sola vez, y la **identidad fiscal del emisor** —CUIT, punto de venta,
condición—, que sí es de cada gym. Con la key por gimnasio, cualquier dueño podía pegar
cualquier cosa en ese campo y romperse la facturación solo, sin que la plataforma se
enterara.

| Qué se fue | De dónde |
|---|---|
| `afipConfig.encryptedApiKey` y `afipConfig.apiKeySecretRef` | `domain/entities/Gym.ts`, `GymSchema.ts` |
| El campo `apiKey` del body | `gym.validator.ts`, `UpdateAfipConfigUseCase` (que ya no necesita `IEncryptionService`) |
| La resolución gym-primero | `MongoGymSecretsRepository.getAfipApiKey()`, que ahora devuelve `AFIP_SDK_API_KEY` y nada más |

El puerto perdió el parámetro: `getAfipApiKey()` sin `gymId`, porque pedirle un gimnasio a
algo que siempre devuelve lo mismo es mentir en la firma.

**Compatibilidad:** un front que siga mandando `apiKey` no rompe. `validateBody` reemplaza el
body por el parseado, así que zod descarta el campo desconocido en silencio — pero tampoco se
guarda en ningún lado. Igual conviene sacarlo de la pantalla
([F1](#f1--pantalla-de-facturación-qué-tiene-que-cargar-el-gimnasio)).

**Datos viejos:** los gimnasios ya creados conservan la key cifrada en Mongo, porque Mongoose
deja de leer los campos pero no los borra. `npm run purge:afip-keys` hace el `$unset`; es
idempotente y no toca `puntoVenta`, `taxCondition` ni `isActive`.

### 2. `AFIP_SDK_ENVIRONMENT`, obligatoria y explícita ✅

Antes se derivaba de `NODE_ENV` si faltaba. Se eliminó esa derivación: ponía una **decisión
fiscal** —emitir de verdad o no— en manos de una variable que se toca por mil motivos ajenos
a la facturación. Ahora el esquema de `config/env.ts` la exige sin default y el proceso no
arranca hasta que alguien la escriba.

El adaptador dejó de leer `process.env`: recibe host y entorno inyectados por
`AfipSdkAdapterFactory`, que es el único punto donde la configuración del despliegue entra a
la facturación. Dentro de `AfipSdkAdapter` solo quedó el armado del comprobante.

⚠️ **Una trampa del `.env` que ya mordió dos veces:** `AFIP_SDK_BASE_URL= 'https://api.afipsdk.com';`
—con comillas y punto y coma, copiado de un archivo TypeScript— **no es una URL válida** y el
server no arranca. El valor va pelado, o vacío para usar el default. `env.ts` trata la
variable vacía como ausente justamente para que dejar la línea en blanco sea seguro.

### 3. Dos CUIT distintos en la misma corrida, probado ✅

`tests/e2e/facturacionArca.test.ts` sumó un tercer test: dos gimnasios con **CUIT, punto de
venta y régimen distintos** emitiendo en **una sola pasada del worker**, con la misma
credencial de plataforma.

Es la prueba del modelo que se eligió al sacar la credencial por gimnasio. Los otros dos
tests montan un gym por vez, así que un adaptador que se quedara con el CUIT del primero
—cacheado, o resuelto una sola vez al arrancar— pasaría igual. Se verificó con una mutación
deliberada: cacheando el adaptador en la factory, el test falla; sin la mutación, pasa.

Verifica además que cada historial vea solo lo suyo: emitir en la misma corrida no puede
filtrar el comprobante de un gimnasio al otro.

⚠️ **Lo que este test NO prueba, y sigue siendo la incógnita que bloquea el paso a `prod`:**
que **AFIP SDK acepte varios CUIT bajo una misma cuenta**, y cómo se cargan los certificados
de cada contribuyente. El mock acepta cualquier cosa. Eso recién se ve contra homologación, y
si el proveedor exigiera una cuenta por CUIT, hay que volver a la credencial por gimnasio.

### 4. El vencimiento de las rutinas era el de la cuota ✅

`routine.fechaVencimiento` guardaba `client.fechaVencimiento` —hasta cuándo el socio pagó—
en vez de la vigencia del plan. Son dos preguntas distintas y ninguna se podía responder:
el PDF le prometía al socio una vigencia que no era la de su rutina, y la tarjeta "rutinas
por vencer" mostraba en realidad vencimientos de membresías.

**La regla ahora es del dominio** (`src/domain/routine/vigencia.ts`): la planificación es
mensual, una rutina generada el día X vence el día **X+30**, y la invariante
`fechaVencimiento = fechaGeneracion + 30 días` vale siempre.

De paso se arregló algo que estaba latente: la fecha de generación se calculaba con tres
`new Date()` distintos —uno para la base y otro para el PDF— así que una generación que
arrancara 23:59 y terminara 00:01 imprimía un día distinto del que guardaba. Ahora sale un
solo instante para toda la generación.

**Los contadores del dashboard pasaron a acumular.** `countExpiringByDay` contaba las que
vencían *exactamente* el día N, así que una rutina a 4 días no aparecía en `en7Dias`,
`en5Dias` ni `en3Dias`, y `en7Dias` no incluía a `en3Dias`. Se renombró a
`countExpiringWithin` —"dentro de N días"— y los tres contadores ahora se anidan. La
semántica no estaba fijada por ningún test contra Mongo; ahora sí, en
`tests/integration/routine/MongoRoutineRepository.test.ts`.

| Para el front | Qué cambia |
|---|---|
| `GET /routines` → `fechaVencimiento` | Mismo campo, mismo tipo, **otro significado**: ahora es la vigencia del plan. Cualquier texto que diga "vence la membresía" al lado de este dato ahora miente |
| `GET /dashboard` → `rutinasPorVencer` | Los tres números **van a subir**: acumulan y leen la fecha correcta |
| `GET /routines/expiring?days=N` | Ahora es "dentro de N días", no "el día N exacto" |
| El PDF | El "Vence" y el "Plan vigente hasta el…" ya dicen la fecha del plan |

**Datos viejos:** las rutinas ya generadas conservan la fecha de la cuota.
`npm run backfill:vencimiento-rutinas` las recalcula desde su `fechaGeneracion` (o su
`createdAt` si quedaron en `error` antes de generarse).

---

## 2 quater. Hecho el 15-08 — sesión que sobrevive al F5 y worker por cron ✅

738 tests (eran 704), `tsc` limpio, `npm run lint` con 0 errores y los mismos 137 warnings.

Cuatro cosas: las dos primeras aparecieron mirando el deploy, las dos últimas son la
preparación para probar la facturación contra el homologación de ARCA.

### 1. Recargar la página deslogueaba ✅

**El síntoma:** apretar F5, o entrar por un link pegado, te tiraba al login. La sesión se
perdía aunque la cookie del refresh token siguiera viva.

**La hipótesis que teníamos era equivocada.** Se sospechaba que el backend rotaba el refresh
token y que una recarga rápida dejaba la cookie vieja. No rota nada: `RefreshTokenUseCase`
solo verifica y firma un access token nuevo, y la cookie no se reescribe nunca.

**La causa real era un contrato roto entre las dos puntas.** `/auth/refresh` devolvía solo
`{ accessToken }`, mientras que `/auth/login` devuelve `{ accessToken, user }`. El front
espera la forma del login:

1. `AuthProvider.tsx:18` llama a `authApi.refresh()`, que resuelve **bien, con 200**.
2. `AuthProvider.tsx:19` hace `setSession(data.user, data.accessToken)` con `data.user`
   en `undefined`.
3. El store guarda `{ user: undefined, accessToken: "eyJ..." }`.
4. `PrivateRoute.tsx:7` ve `!user` y redirige a `/login`.

El `catch` del `AuthProvider` **nunca se ejecutaba**, porque no había excepción: el refresh
era exitoso. Por eso mirar la pestaña de red despistaba — el request se veía en verde.

⚠️ **Lo notable:** `docs/API_ENDPOINTS.md` ya documentaba `{ accessToken, user }`, el tipo
`AuthSession` del front ya lo declaraba y `LoginUseCase` ya lo devolvía. Los tres coincidían.
El único que se había desviado del contrato era el caso de uso, y no había ningún test que
lo sostuviera.

**Cómo quedó:** `RefreshTokenUseCase` devuelve el `user` junto al token. Ya lo tenía en la
mano desde su propio `findById`, así que no hay query extra ni cambio de latencia. **El front
no se tocó.** Cubierto por `tests/unit/auth/RefreshTokenUseCase.test.ts`, 7 tests: el de la
regresión, que el access token lleve el claim `gymId` (sin eso se rompe el aislamiento entre
tenants), que no se filtre el `passwordHash`, y los cuatro rechazos — firma falsa, token
vencido, usuario desactivado, usuario inexistente.

### 2. El worker de facturación se puede disparar por cron ✅

**Por qué:** `InvoiceEmissionScheduler` es un `setInterval` dentro del proceso del server.
Eso obliga a que el proceso esté siempre vivo — en un tier que hiberna por inactividad, el
worker se duerme con él y las facturas pendientes no se emiten hasta que alguien entre a la
app. Es también la razón por la que dos instancias del server correrían dos workers
compitiendo por el mismo lease.

**Salió más barato de lo esperado** porque la arquitectura ya lo tenía previsto: el lease de
`claimPendiente` es un `findOneAndUpdate` atómico en Mongo, así que la seguridad contra doble
emisión **no dependía del temporizador**. El `tickEnCurso` del scheduler era una optimización,
no la garantía. Y `EmitPendingInvoicesUseCase` ya lo decía en su docstring: *"quién lo llama y
cada cuánto es problema del scheduler"*.

| Qué | Dónde |
|---|---|
| `INVOICE_WORKER_MODE` (`interno` \| `cron`), `INVOICE_CRON_SECRET`, `INVOICE_JOB_MAX` | `src/config/env.ts` |
| Puerta del disparador, con comparación en tiempo constante | `src/interfaces/http/middlewares/internalAuthMiddleware.ts` |
| El endpoint | `src/interfaces/http/controllers/InternalJobsController.ts` + `routes/internal.routes.ts` |
| Montaje **antes** del `authMiddleware` global | `src/interfaces/http/routes/index.ts` |
| El scheduler arranca solo en modo `interno` | `src/server.ts` |
| Contrato del endpoint | [`docs/API_ENDPOINTS.md` §12 bis](docs/API_ENDPOINTS.md) |

**La decisión no obvia — el tope por corrida.** `MAX_POR_TICK = 5` con un tick de 15s da 20
facturas por minuto. Un cron cada 5 minutos con ese mismo tope daría **1 por minuto**: una
degradación de 20x que no se nota hasta que hay backlog. Por eso `execute()` ahora acepta
`maxFacturas` (50 por defecto vía `INVOICE_JOB_MAX`) y un presupuesto de 25s, para que el
request no quede colgado más de lo que un cron externo espera. El resumen incluye `truncado`:
**si viene `true` de forma sostenida, la cadencia no da abasto** — es el único indicador de
que la cola se acumula.

El chequeo de tiempo va **antes** de reclamar la factura, no después: tomar una y no llegar a
emitirla la dejaría reservada 5 minutos por el lease sin que nadie lo haya intentado.

**Seguridad.** El secreto es global y estático, distinto del `webhookSecret` por-gym del
onboarding: aquel identifica **a qué gimnasio** pertenece una submission, este solo dice *"el
que llama es nuestro cron"*. Se compara hasheando a 32 bytes antes de `timingSafeEqual`,
porque esa función **lanza** si los buffers miden distinto — sin el hash, un secreto de otro
largo daría 500 en vez de 401, y ese 500 delataría el largo del secreto real. Sin
`INVOICE_CRON_SECRET` el endpoint responde **503, no 200**: se cierra, no se abre.

**Nada cambia si no se toca nada.** `INVOICE_WORKER_MODE` default `interno`: el
comportamiento actual es idéntico hasta que alguien ponga `cron` en el `.env`.

**Qué falta para usarlo de verdad:** configurar el cron externo (cron-job.org, GitHub Actions,
o el Cron Job de Render si se paga) apuntando a `POST /api/internal/jobs/emit-invoices` con el
header `x-internal-secret`. Eso vive fuera del repo y depende de [D2](#d2--tier-de-pago-para-el-backend--al-primer-gimnasio-que-pague).

### 3. El circuito de facturación, probado de punta a punta ✅

`tests/e2e/facturacionArca.test.ts` — **3 tests** (eran 2, uno por régimen fiscal; el tercero
llegó el 19-08 con el caso multi-CUIT). Cubren el viaje
que no tenía cobertura entera: alta de gym → configurar AFIP → alta de socio → renovar → la
factura queda encolada → el disparador la emite → el comprobante persiste con su CAE. Los
unit tests de `EmitPendingInvoicesUseCase` probaban ese eslabón con mocks y
`invoices.test.ts` probaba el historial ya emitido; en el medio no había nada.

**Se mockea `axios`, no el `IInvoiceProvider`.** Cortar en el puerto probaría que el caso de
uso llama a algo, pero el armado del comprobante fiscal —tipo, desglose de IVA, CUIT del
emisor— vive en `AfipSdkAdapter`. Mockear más arriba dejaría sin probar justo lo que hay que
verificar antes de apuntar al homologación real.

| | Monotributo | Responsable Inscripto |
|---|---|---|
| Comprobante | Factura C (código 11) | Factura B (código 6) |
| IVA | **No discrimina** — neto = total | **Discrimina** — neto + IVA = total exacto |
| Renovar habla con ARCA | No — queda `pendiente` | No — queda `pendiente` |

En ambos se verifica además que el CUIT del emisor viaje entero como número (cargado con
guiones, el `parseInt` viejo devolvía `30`) y que el DNI del socio de **7 dígitos** viaje con
`tipo_documento: 96`.

> 📌 **Corregido el 19-08:** este test afirmaba que la credencial del header era **la del
> gym**. Dejó de ser cierto: la cuenta de AFIP SDK es única y de la plataforma
> ([§2 quinquies](#2-quinquies-hecho-el-19-08--cuenta-única-de-afip-y-vencimiento-de-rutinas-)). La aserción
> se dio vuelta y se sumó un tercer test con dos CUIT emisores distintos.

⚠️ **Una aserción que hubo que corregir, no el código.** El primer intento afirmaba
`importe_iva ≈ neto × 0.21` y falló por medio centavo. El adaptador calcula el IVA por
**resta** (`total − neto`), a propósito: con 15000 el neto es 12396.69 y el 21% puro daría
2603.3049, medio centavo menos que el 2603.31 que se informa. Se elige que **la suma cierre
exacto** —que es lo que ARCA valida— por sobre que el porcentaje lo haga. La aserción quedó
con la tolerancia correcta y el porqué escrito: ponerla estricta sería pedir el bug de vuelta.

### 4. Entorno y host de ARCA, configurables ✅

Hasta acá el `baseURL` estaba hardcodeado y no había forma de apuntar al homologación.

| Variable | Qué hace |
|---|---|
| `AFIP_SDK_BASE_URL` | Host de la API REST. Vacía = `https://api.afipsdk.com` |
| `AFIP_SDK_ENVIRONMENT` | **Obligatoria.** `dev` (homologación) o `prod` (comprobantes reales) |

El `environment` viaja en el cuerpo del request y **se define en el `.env`, no se deriva de
`NODE_ENV`**. La derivación automática se eliminó: ponía una decisión fiscal —emitir de
verdad o no— en manos de una variable que se toca por mil motivos ajenos a la facturación,
y un comprobante emitido de más ante ARCA no se borra, se anula con nota de crédito. Ahora
el esquema de `config/env.ts` la exige sin default: si falta o está mal escrita, el proceso
no arranca en vez de elegir por su cuenta. Siguen los warnings al arrancar para los dos
cruces raros con `NODE_ENV` (`prod` fuera de producción, `dev` en producción), y los tests
viven en `tests/unit/config/entornoAfip.test.ts`, incluido que un valor mal escrito
(`production` en vez de `prod`) **no** cuele como producción.

El adaptador ya no lee `process.env`: recibe host y entorno inyectados por
`AfipSdkAdapterFactory`, que es el único punto donde la configuración del despliegue entra a
la facturación. Dentro de `AfipSdkAdapter` solo queda el armado del comprobante.

⚠️ **Sin verificar, y es lo primero que va a aparecer al probar contra ARCA:** el ejemplo de
autenticación de AFIP SDK (`{ environment, tax_id, wsid: "wsfe" }`) tiene forma de una
**llamada de auth previa**, y este adaptador no hace ninguna: postea la factura directo a
`/v1/facturas` con un Bearer token. El `environment` se puso en el cuerpo del comprobante
porque es el único lugar que existe hoy. Si AFIP SDK exige el par auth → token, lo que hay
que revisar no es esta variable sino el flujo entero del adaptador.

---

## 2 ter. Hecho el 11-08 — facturación AFIP de punta a punta ✅

704 tests (eran 687 antes de esta tanda), `tsc` limpio, lint con 0 errores.

Ocho problemas del flujo de facturación, cerrados de a uno. Los cinco primeros eran fallas
que impedían facturar bien; los tres últimos, deuda estructural.

| # | Qué pasaba | Cómo quedó |
|---|---|---|
| 1 | **`EXENTO` era una opción** y caía en la rama de Responsable Inscripto: le discriminaba IVA al 21% a quien no debe | Fuera del enum. Solo `MONOTRIBUTO` y `RESPONSABLE_INSCRIPTO`, que son las condiciones con fines de lucro |
| 2 | **El CUIT nunca viajaba a AFIP.** `TenantApiConfig.cuit` se llenaba y el adaptador no lo usaba. Y `parseInt('20-12345678-9')` devuelve `20` sin quejarse | Va en el request. `normalizarCuit` exige once dígitos o falla explícito ([F1](#f1--pantalla-de-facturación-qué-tiene-que-cargar-el-gimnasio) para el front) |
| 3 | **El tipo de comprobante se decidía dos veces**, en el adaptador y en el caso de uso, y `isConsumidorFinal` estaba fijo en `true` | Una sola tabla, `COMPROBANTE_POR_CONDICION`. El socio siempre es consumidor final: monotributista → **Factura C**, responsable inscripto → **Factura B**. La A no existe en este negocio |
| 4 | **Se guardaba solo el CAE.** Se perdían número, punto de venta, vencimiento del CAE y el desglose de IVA | La factura guarda la terna que la identifica ante AFIP, el vencimiento, `neto`/`iva` y la descripción |
| 5 | **Emisión sincrónica**: el socio esperaba en la ventanilla hasta 15s —el timeout del adaptador— para que le renovaran la cuota | La renovación deja la factura en `pendiente` y responde. Emite el worker |
| 6 | **Sin reintentos.** Una factura en `error` quedaba muerta y `update()` no lo llamaba nadie | Backoff automático para fallos transitorios (5 intentos) y `POST /invoices/:id/retry` para los de validación |
| 7 | **`invoiceWorker.ts` existía solo en `dist/`**: un `Worker` de BullMQ contra un Redis que ya no está en `src` | `InvoiceEmissionScheduler` in-process. La cola es la propia colección de facturas: sin Redis, y el estado sobrevive a los reinicios |
| 8 | `baseURL` y endpoint hardcodeados con un comentario que prometía `env` | ~~Se quedan estáticos~~ → **revertido el 15-08**: `AFIP_SDK_BASE_URL` y `AFIP_SDK_ENVIRONMENT` son configurables, y desde el 19-08 el adaptador ya no las lee por su cuenta |

**Cómo funciona ahora la cola.** `claimPendiente` reserva con un solo `findOneAndUpdate`
atómico e incrementa el contador **al tomar** la factura, no al fallar: si el proceso muere
en la mitad de una emisión, ese intento igual se gastó. La reserva vence a los 5 minutos
(*lease*), muy por encima del timeout de 15s del adaptador, así que dos ticks no pueden
emitir el mismo comprobante — que ante AFIP no se borra, se anula con nota de crédito.

**Un bug que apareció al testear:** `proximoIntento` tenía `default: Date.now` en el schema,
y Mongoose **reaplica los defaults al hidratar** un documento al que le falta el campo. Una
factura ya emitida se leía con un `proximoIntento` fabricado en el momento, como si siguiera
encolada. El default salió; el valor inicial lo pone el repositorio.

**Deuda que esto deja anotada:** la nota de crédito. El estado `anulada` existe en el
dominio desde antes y sigue sin que nada lo produzca. Anular es el único camino para
deshacer un comprobante emitido de más, así que en algún momento hay que implementarlo.

---

## 2 bis. Hecho el 11-08 — P3-A, retención en la serie ✅

650 tests (eran 644), `tsc` limpio, lint con 0 errores.

`churnMensual` y `tasaRetencion` viajan ahora en cada punto de `/dashboard/kpis/series`,
como fracción `[0,1]`. Salen de `monthlyChurnRate` y `retentionRate` —las mismas
funciones de dominio que usa `/dashboard/kpis`— aplicadas sobre el historial **ya leído**:
la regla de la lectura única sigue intacta y hay un test propio que la vuelve a fijar para
estos dos campos.

**Un caso de `null` que no estaba en el pedido y apareció escribiéndolo:** además de los
meses anteriores a `datosCompletosDesde`, los dos campos van en `null` cuando el mes
**arranca con la base en cero**. `monthlyChurnRate` y `retentionRate` ya devolvían `null`
con `membersAtStart <= 0`, así que no hubo que decidir nada — pero es el caso de los
primeros meses de cualquier gimnasio, o sea el que el front va a ver primero. En el
fixture de test es enero: un mes con un alta real y las dos tasas en `null`. Un 0% de
churn ahí afirmaría que no se fue nadie de un padrón que todavía no existía.

`cohorte90Dias` **no entró y no es un olvido**: es móvil contra `now`, no del mes. Hay dos
tests —uno unitario y uno e2e— que fijan su ausencia, para que no entre después "por
simetría" con los otros dos.

El criterio de aceptación quedó fijado en `tests/e2e/dashboardKpis.test.ts`, en el test
que ya comparaba el punto del mes en curso contra `/dashboard/kpis`: se le sumaron las dos
tasas. Los dos endpoints resuelven el mismo período por default, así que la gráfica y la
tarjeta tienen que dar el mismo número.

**Qué hace el front:** nada obligatorio, es aditivo. Cuando quiera, agrega la tercera
gráfica al lado de `AltasBajasChart` y `EvolucionFinanciera` — con la advertencia de que
los meses fundacionales vienen en `null` por diseño y hay que dibujar el hueco, no un
cero.

---

## 3. Hecho en la tanda del 10-08

Cinco tareas, 644 tests (eran 642), `tsc` y lint limpios. Está acá y no borrado porque
tres de las cinco son correcciones silenciosas: nadie las ve mirando la API, y sin este
registro la próxima persona que toque esos archivos las deshace sin enterarse.

### P1-A — Los dos conteos de socios activos, unificados ✅

`GET /dashboard` decía `clientesActivos: 3` y `GET /dashboard/kpis` decía
`socios.activos: 2` **en la misma pantalla**, porque el primero contaba
`estado: 'activo'`, que es el flag del **borrado lógico** y no el estado de la membresía.

Se resolvió por la **opción 1: unificar el criterio**. `clientesActivos` y
`clientesRecurrentes` cuentan ahora membresías **vigentes o en gracia**
(`GetGymDashboardUseCase.ts:60-70`), con el límite calculado desde
`DIAS_DE_GRACIA_POR_DEFECTO` y no con un 5 escrito a mano (`:110`). El nombre del campo no
cambió y el front no tocó nada.

> ⚠️ **El documento anterior afirmaba algo falso, y es la trampa a recordar.** Decía:
> *"`MongoClientRepository` ya lo traduce. No hace falta tocar el repositorio."* **No lo
> traducía.** `vencimientoDesde` y `vencimientoHasta` estaban declarados en
> `ClientSearchFilters` desde antes y `buildQuery` los ignoraba por completo: pasarlos no
> filtraba nada, no fallaba y no avisaba. Siguiendo la instrucción al pie de la letra,
> `clientesActivos` habría quedado igual de mal con todos los tests en verde.
>
> Se implementó en `MongoClientRepository.ts:83-95`, semiabierto como el resto de los
> rangos. **Un filtro declarado en el puerto no está implementado hasta verlo en la
> query** — es la misma clase de bug que el `desde`/`hasta` de facturas que Zod descarta
> en silencio.

Tests: `tests/integration/client/MongoClientRepository.test.ts` (el filtro contra Mongo
real, que es donde vivía el hueco) y `tests/e2e/dashboardKpis.test.ts`, con la aserción
que fija el contrato: `dashboard.clientesActivos === kpis.socios.activos` sobre el mismo
fixture.

### P1-B — El promedio que extrapolaba desde horas de datos ✅

`visitasPorSocioPorSemana` devolvía `23.2` en un gimnasio con 2 socios y 2 check-ins: el
denominador eran ~7,2 horas. No era un promedio, era una proyección de siete horas a
siete días.

`avgVisitsPerMemberPerWeek` devuelve `null` por debajo de
`DIAS_MINIMOS_PARA_PROMEDIO_SEMANAL` (`domain/kpis/engagement.ts:22,48`), que es
exactamente una semana porque es la unidad en la que se expresa la métrica. El corte
aplica también cuando el **período pedido** es corto, no solo cuando el registro es nuevo.
`registroDesde` sigue viajando siempre, y `enRiesgo` conserva su umbral propio de 14 días
—es otra afirmación y necesita otra evidencia—.

El sitio de llamada no se tocó: ya pasaba el denominador correcto.

### P2-A — `enRiesgo.clientIds` eliminado ✅

El front confirmó que migró a `socios`. Salió de la interfaz (`GetGymKpisUseCase.ts:74`),
del objeto construido (`:375`) y del docstring que anunciaba la duplicación temporal.
`findAtRiskMembers` sigue devolviendo ids —es lo correcto para una función de dominio— y
el nombre lo resuelve el caso de uso.

### P2-B — `API_ENDPOINTS.md`, al día y mudado ✅

**Ahora vive en [`docs/API_ENDPOINTS.md`](docs/API_ENDPOINTS.md)**, escrito de cero contra
el código: el documento describe el backend y se desactualiza justo cuando cambia el
backend, así que conviene que viva al lado del código que lo invalida.

Cubre lo que faltaba —`kpis/series`, `heatmap`, `contacto`, `google-form`,
`rotate-secret`, el bloque `embudo`, `timezone`, `afipConfig`, `clientNombre`, la forma
real de `googleFormConfig` sin el secreto— y arranca con las **reglas transversales**: el
envelope anidado, los centavos, los dos formatos de fecha, el tenant y la regla del
`null`. Son lo que más caro sale descubrir tarde y no estaban escritas en ningún lado.

> 🧹 **Pendiente del lado del front:** la copia vieja quedó en `front/API_ENDPOINTS.md` y
> **no está trackeada en git**, así que no se borró desde acá —sería irrecuperable—.
> Conviene borrarla o dejar un puntero a este repo: mientras las dos existan, alguien va a
> tipar contra la equivocada.

### P3-C — Listado de rutinas por gimnasio ✅

`GET /api/routines`, paginado y filtrado en la base: `clientId`, `estadoEnvio`,
`estadoGeneracion`, `vencimientoDesde`/`vencimientoHasta`, `limit` con tope de 100 como
facturas.

- Puerto: `IRoutineRepository.search()` + `RoutineListItem` (`:40`).
- Adaptador: `MongoRoutineRepository.search()` (`:56`), con `$lookup` **después** de
  paginar para resolver los nombres de las 20 filas de la página y no los de todo el
  historial.
- Caso de uso: `SearchRoutinesUseCase`, mismo tope y mismo criterio de paginado que
  `SearchInvoicesUseCase`.
- Ruta: `routine.routes.ts:88`, antes de `/:id`. El `tenantMiddleware` ya lo aplicaba
  `routes/index.ts`.

Cada fila trae **`clientNombre` resuelto**, `null` si el socio fue borrado. Es la misma
lección de `/checkins`: sin el nombre, el front vuelve a cruzar contra el padrón cacheado
y ese cruce ya se borró una vez por buenas razones.

**Qué hace el front:** reemplaza el hook `useClientRoutineStatuses` —que disparaba una
consulta por socio visible— y **la tabla no cambia**. Se retira el `Callout` que avisa que
los filtros son parciales, porque dejaron de serlo.

---

## 4. Encontrado de paso — también cerrado

Tres cosas que no estaban en la lista y aparecieron trabajando.

### 4.1 `npm run typecheck` estaba en rojo

27 errores, todos en `tests/unit/dashboard/GetGymKpisSeriesUseCase.test.ts`, por un helper
tipado como `{ desde: Date }` que borraba el resto de los campos del punto. Se hizo
genérico (`:60`). Una línea. Vale anotarlo porque un `tsc` que ya está rojo deja de servir
como puerta de calidad: el error 28 pasa desapercibido.

### 4.2 El rojo conocido de `datosCompletosDesde`, resuelto

`dashboardKpis.test.ts > manda las fechas sin hora` fallaba desde antes de la tanda 4
porque el test exigía `yyyy-MM-dd` y el controller mandaba ISO completo.

**Ganó el controller**, y la decisión quedó cerrada: **las fechas se serializan por
significado, no por endpoint** (`DashboardController.ts:14-33`). Límite de período →
`yyyy-MM-dd`; instante → ISO completo. Es una regla mejor que la que se había acordado,
porque el criterio es el significado del campo y no dónde aparece.

Se sumó además un test que fija que los dos endpoints de KPIs manden `datosCompletosDesde`
**idéntico**: era el punto exacto donde el front tenía que ramificar por endpoint para
parsear un campo con un solo significado.

> 📌 **Nota para el front:** la memoria `huecos-api-conocidos` dice que el campo viaja en
> dos formatos. Está desactualizada.

### 4.3 Dos tests que afirmaban lo que P1-B corrige

`GetGymKpisUseCase.test.ts` y el e2e de engagement daban por bueno un promedio semanal
sobre 5,5 días y sobre horas. Eran justamente el bug, expresado como expectativa. Se
actualizaron y se agregó el caso de 8 días, que sí devuelve valor.

---

## 5. Cerrado — no reabrir sin motivo nuevo

- **Las fechas se serializan por significado, no por endpoint** (§4.2). Reemplaza al
  acuerdo anterior de unificar todo a `yyyy-MM-dd`.
- **Los dos cortes de zona horaria son distintos** —períodos de KPI en UTC, día calendario
  y franjas horarias en la zona del gimnasio—. No es incoherencia: son dos preguntas
  distintas. Detalle en `docs/API_ENDPOINTS.md` §1.6.
- **`clientesActivos` cuenta vigentes + en gracia**, y tiene que seguir coincidiendo con
  `socios.activos`. Hay un e2e que lo fija.
- **El promedio semanal tiene piso de 7 días y el riesgo de 14.** Son dos umbrales
  distintos a propósito, porque afirman cosas distintas.
- **El `limit` de `/checkins` queda en 500** como red de seguridad. El camino previsto es
  `/checkins/heatmap`.
- **El webhook no vuelve a crear clientes.** Un DNI desconocido es un tipeo, no un socio
  nuevo.
- **`POST /clients/:id/contacto` no actualiza la fecha.** Mide el *primer* contacto.
- **La serie sale de UNA sola lectura del historial.** Hay un test que cuenta invocaciones
  al puerto. Es la razón de existir del endpoint.
- **`cohorte90Dias` no va en la serie.** Es móvil contra *hoy*, no una métrica del mes.
  Dos tests fijan su ausencia. Si algún día se pide, es la cohorte *de cada mes*, que es
  otro cálculo y no este campo mudado de lugar.
- **`Client.estado: 'inactivo'` es borrado lógico**, no una baja del gimnasio.
- **Un socio vencido puede registrar ingreso** (es la señal de que volvió); uno `inactivo`
  da 400; uno de otro gimnasio da 404.
- **`/clients/:id/invoices` no se construye.** `GET /invoices?clientId=` ya hace
  exactamente eso, verificado de punta a punta. El 404 es del lado del front.
- **No hay ni va a haber** pantalla de clases, reservas, CAC, payback, margen bruto ni
  trials. `GET /dashboard/summary` es del panel de plataforma, no del CRM del gimnasio.
- **Cada gimnasio factura contra su propia cuenta de AFIP SDK** (revertido el 20-08, ver
  [§2 sexies](#2-sexies-hecho-el-20-08--vuelta-a-cuenta-propia-factura-a-y-credenciales-por-gym-)).
  El modo de cuenta única de plataforma sigue en el código, desconectado detrás de
  `AFIP_BILLING_MODE`, por si algún día se confirma que el proveedor soporta varios CUIT
  por cuenta y se retoma.
- **El comprobante depende de la condición fiscal del gimnasio Y del socio.** Un socio
  Responsable Inscripto factura Factura A a su propio CUIT; cualquier otro caso, a su DNI.
  No es solo la condición del gym como antes del 20-08.
- **`AFIP_SDK_ENVIRONMENT` no se deriva de `NODE_ENV`.** Emitir comprobantes reales o de
  prueba es una decisión fiscal y se escribe explícita en el entorno.
- **La renovación no factura sincrónicamente.** Deja la factura en `pendiente` y responde;
  emite el worker. El front no debe esperar un CAE en esa respuesta.
- **`GET /gyms/settings/mercadopago/connect` devuelve JSON (`{ data: { url } }`), no un
  `302`.** Corregido el 21-08 al implementar el front: una navegación real de browser no
  puede llevar el `Authorization: Bearer` que exige `authMiddleware`, porque el access
  token vive solo en memoria. El front pide la URL con un GET autenticado y recién ahí
  navega él mismo.
- **El badge "Renovación Pendiente" no vive en `Client` ni en el listado paginado de
  socios.** Se deriva de `GET /clients/:id/renewal-requests`, solo en la ficha individual
  — mostrarlo en el listado exigiría un endpoint agregado por gimnasio que hoy no existe.
  Si se pide, ver [§2 octies](#2-octies-hecho-el-21-08-frontend--f1-f2-y-f3-implementadas-y-verificadas-en-vivo-)
  punto 3 para la forma correcta.

---

## 6. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Contrato de la API, endpoint por endpoint | [`docs/API_ENDPOINTS.md`](docs/API_ENDPOINTS.md) |
| Reglas transversales (envelope, tenant, `null`, unidades, fechas, zona horaria) | `docs/API_ENDPOINTS.md` §1 |
| Semánticas que no se deducen del JSON (gracia, embudo, idempotencia, secreto) | `docs/API_ENDPOINTS.md`, en cada endpoint |
| Definición de los KPIs y sus fórmulas | `kpis-gimnasio-dominio.md` |
| Qué falta hacer | **este archivo** |
| Qué tiene que mandar el front para facturar | **este archivo**, [F1](#f1--pantalla-de-facturación-qué-tiene-que-cargar-el-gimnasio) |
| Instalación del Apps Script del Form | `docs/google-forms/README.md` |
| Variables de entorno, con el porqué de cada una | `.env.example` |
| Scripts de mantenimiento (los dos hay que correrlos a mano) | `src/scripts/`, registrados en `package.json` |
| Reglas de vigencia de una rutina | `src/domain/routine/vigencia.ts` |
| Disparador interno del worker (no lo consume el front) | `docs/API_ENDPOINTS.md` §12 bis |

---

## 7. Deuda anotada, no abierta

Ninguna bloquea nada. Están acá para no redescubrirlas.

- **El logout no invalida nada del lado del servidor.** `AuthController.logout` borra la
  cookie y nada más — el comentario del código ya lo asume. Pero el refresh token es un JWT
  firmado con 7 días de validez: quien lo haya capturado antes del "cerrar sesión" lo sigue
  pudiendo usar hasta que venza. Arreglarlo requiere una lista de revocación o un
  `tokenVersion` en el usuario que se incremente al desloguear. No es urgente mientras la
  cookie sea `httpOnly`, pero es una promesa que la UI hace y el backend no cumple.
- **`RefreshTokenUseCase` envuelve todo en un `try/catch` que traga el motivo real.**
  Un fallo de Mongo dentro del `execute` sale como `UnauthorizedError('Invalid or expired
  refresh token')`, igual que un token falsificado. Si algún día el refresh empieza a
  rebotar de forma inexplicable, el mensaje va a mentir sobre la causa.
- **Los tests unitarios dependen de Mongo.** `tests/setup.ts` levanta
  `mongodb-memory-server` en un `beforeAll` **global**, así que los unit tests de casos de
  uso —que son mocks puros y no tocan la base— pagan el arranque igual. Funciona y corre
  offline; el costo es tiempo de suite, no falsos rojos.
- **Los fixtures de `dashboardKpis.test.ts` están anclados a 2026** y se comparan contra
  el reloj real. El escenario base tiene un socio que vence el 31/12/2026: a partir de
  enero de 2027 empieza a contar como de baja y varias aserciones se mueven. No es urgente
  y es un arreglo de una tarde —congelar el reloj o derivar las fechas de `now`—, pero es
  una bomba de tiempo literal.
- **137 warnings de ESLint**, todos de estilo (`no-explicit-any` y
  `explicit-function-return-type`) y consistentes con el resto del repo. 0 errores.

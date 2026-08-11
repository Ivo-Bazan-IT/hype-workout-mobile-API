# Conectar un Google Form al CRM

Google Forms **no tiene webhooks nativos**. Para que las respuestas de la encuesta de
ingreso lleguen al CRM hay que instalar un pequeño script del lado de Google (Apps
Script) que, cada vez que alguien completa el formulario, se lo avise al backend.

Se hace **una vez por gimnasio** y lleva unos 10 minutos.

> El código a instalar está en [`onFormSubmit.gs`](./onFormSubmit.gs), en esta misma
> carpeta.

---

## Antes de empezar: cómo encaja el formulario en el onboarding

> ⚠️ **El formulario NO da de alta socios.** El orden es: se carga al socio en el panel
> → paga → contesta el formulario. La respuesta se pega sobre la ficha que ya existe,
> buscándola por **documento**, que es el único valor único que tiene un cliente dentro
> del gimnasio.
>
> Si llega una respuesta con un DNI que no está en la base, se rechaza con `404` y queda
> asentada como rechazo (visible en `GET /api/onboarding/status`). Casi siempre es un DNI
> mal tipeado o un socio que todavía no se cargó.

El único dato **imprescindible** es el documento: sin él no hay forma de saber a quién
corresponde la respuesta. Si el formulario no lo pide, se rechaza con `400`.

| Dato          | Cómo puede llamarse la pregunta                  | ¿Obligatorio? |
| ------------- | ------------------------------------------------ | ------------- |
| **Documento** | contiene `dni` o `documento`                     | **Sí**        |
| **Nombre**    | contiene `nombre` o `name`                       | No — si viene, refresca la ficha |
| **Teléfono**  | contiene `telefono`, `teléfono` o `phone`        | No — si viene, refresca la ficha |
| **Email**     | contiene `email`, `correo` o `mail`              | No           |

Nombre, teléfono y email **actualizan** la ficha cuando la respuesta los trae. Si el
formulario no los pregunta, lo que ya estaba cargado no se toca.

**El resto de las preguntas son libres.** Todas se guardan tal cual en `encuestaData` y
son las que la IA usa para armar la rutina, así que cuantas más y mejores, más
personalizada sale: objetivo, días disponibles, lesiones, experiencia previa,
equipamiento.

### Cuatro preguntas que además el prompt puede usar sueltas

Cualquier pregunta llega a la IA dentro del bloque `{{respuestas_encuesta}}`, que vuelca
el JSON completo. Pero hay cuatro que el prompt puede inyectar **una por una**, para
poder escribir *"entrena {{cliente_dias_por_semana}} veces por semana"* en vez de
pedirle al modelo que interprete un JSON:

| Placeholder                  | Se resuelve con una pregunta que contenga        |
| ---------------------------- | ------------------------------------------------ |
| `{{cliente_edad}}`           | `edad`, `age`, `años`                            |
| `{{cliente_objetivo}}`       | `objetivo`, `objetivos`, `meta`, `goal`          |
| `{{cliente_lesiones}}`       | `lesiones`, `lesion`, `dolencias`, `molestias`   |
| `{{cliente_dias_por_semana}}`| `cantidad de dias`, `dias a la semana`, `frecuencia` |

Si la pregunta no existe o quedó sin contestar, el placeholder se reemplaza por
`no informado` — nunca por un hueco vacío, que llevaría al modelo a inventar el dato.
En las preguntas de casillas (varias opciones a la vez) se unen todas las elegidas
separadas por coma.

> 💡 **Si tus preguntas se llaman distinto**, no hace falta renombrarlas: se declara el
> mapeo desde el panel (**Configuración → Google Forms → Mapeo de campos**) indicando qué
> pregunta corresponde a cada dato. Ver [Paso 8](#paso-8--ajustar-el-mapeo-si-hace-falta).

---

## Paso 1 — Obtener el ID del gimnasio y el secreto

Desde el panel del CRM, con la sesión del gimnasio:

1. Ir a **Configuración → Google Forms**.
2. Presionar **Generar / Rotar secreto**.
3. Copiar el secreto que aparece.

> 🔒 **El secreto se muestra una sola vez.** El backend guarda únicamente un hash, así
> que no hay forma de volver a consultarlo. Si se pierde, se genera uno nuevo — pero
> ojo: **generar uno nuevo invalida el anterior** y el formulario deja de entrar hasta
> que se actualice el script.

Vas a necesitar también el **ID del gimnasio**, que aparece en la misma pantalla.

<details>
<summary>Equivalente por API, para hacerlo sin panel</summary>

```bash
curl -X POST https://tu-dominio.com/api/gyms/settings/google-form/rotate-secret \
  -H "Authorization: Bearer <access-token-del-gym>"
```

```json
{
  "status": "success",
  "data": {
    "secret": "gfw_9f3a1c...",
    "webhookSecretUpdatedAt": "2026-07-29T14:03:00.000Z",
    "message": "Guardá este secreto ahora: no se puede volver a consultar."
  }
}
```

</details>

---

## Paso 2 — Abrir el editor de Apps Script

1. Abrir el **Google Form** (en modo edición).
2. Menú **⋮** (tres puntos, arriba a la derecha) → **Editor de secuencias de comandos**.
3. Se abre una pestaña nueva con un archivo `Código.gs` que trae una función vacía.

> Es importante abrirlo **desde el formulario** y no crear un proyecto de Apps Script
> suelto: el script tiene que quedar vinculado al Form para poder instalar el trigger.

---

## Paso 3 — Pegar el código

Borrar todo lo que haya en `Código.gs` y pegar el contenido completo de
[`onFormSubmit.gs`](./onFormSubmit.gs). Guardar con **Ctrl+S**.

---

## Paso 4 — Cargar la configuración

El secreto **no va escrito en el código** — cualquiera con permiso de edición sobre el
formulario podría leerlo. Va en las propiedades del proyecto:

1. En el editor, ir a **⚙️ Configuración del proyecto** (engranaje, barra izquierda).
2. Bajar hasta **Propiedades del script** → **Agregar propiedad de script**.
3. Cargar estas tres:

| Propiedad             | Valor                                            |
| --------------------- | ------------------------------------------------ |
| `CRM_WEBHOOK_URL`     | `https://tu-dominio.com/api/onboarding/webhook`  |
| `CRM_GYM_ID`          | El ID del gimnasio del Paso 1                    |
| `CRM_WEBHOOK_SECRET`  | El secreto del Paso 1                            |

4. **Guardar propiedades del script**.

---

## Paso 5 — Verificar y autorizar

Volver al editor de código y:

1. Elegir la función **`verificarConfiguracion`** en el desplegable de arriba.
2. Presionar **▶ Ejecutar**.
3. Google va a pedir permisos la primera vez:
   - **Revisar permisos** → elegir la cuenta.
   - Va a aparecer *"Google no verificó esta aplicación"*: es normal, el script es
     propio y no está publicado. **Configuración avanzada** → **Ir a (nombre del
     proyecto)**.
   - **Permitir**.
4. En el panel de **Registro de ejecución** tiene que decir `✅ Configuración completa.`

---

## Paso 6 — Instalar el disparador

1. Elegir la función **`instalarTrigger`** en el desplegable.
2. **▶ Ejecutar**.
3. El registro debe decir `✅ Trigger instalado.`

Esto conecta el evento *"al enviar el formulario"* con el script. La función borra
primero cualquier disparador anterior, así que se puede ejecutar de nuevo sin miedo a
que las respuestas se manden por duplicado.

---

## Paso 7 — Probar

**Opción A (rápida):** abrir la función **`probarEnvio`** y reemplazar
`CAMBIAR_POR_UN_DNI_QUE_EXISTA` por el documento de un socio real del gimnasio. Después
ejecutarla.

> ⚠️ No crea ningún cliente: **pisa la encuesta del socio que elijas** con datos de
> prueba. Conviene usar un socio de prueba, o volver a completar su encuesta después.

**Opción B (real):** dar de alta un socio en el panel y completar el formulario con su
DNI. En unos segundos su ficha debería mostrar las respuestas cargadas.

Cualquiera de las dos: si el DNI no existe en el gimnasio, la respuesta se rechaza con
`404` y queda listada en `GET /api/onboarding/status`.

Listo: a partir de acá cada respuesta entra sola.

---

## Paso 8 — Ajustar el mapeo (si hace falta)

Solo si en el Paso 7 el cliente entró con datos cruzados (por ejemplo, el nombre salió
siendo el usuario de Instagram) o el envío falló con un `400` diciendo qué campo falta.

El CRM adivina qué pregunta es cuál mirando el título. Cuando adivina mal, se le dice
explícitamente desde **Configuración → Google Forms → Mapeo de campos**: para cada dato,
se elige el **título exacto** de la pregunta correspondiente.

<details>
<summary>Equivalente por API</summary>

```bash
curl -X PUT https://tu-dominio.com/api/gyms/settings/google-form \
  -H "Authorization: Bearer <access-token-del-gym>" \
  -H "Content-Type: application/json" \
  -d '{
    "fieldMapping": {
      "nombre": "¿Cómo querés que te llamemos?",
      "documento": "DNI",
      "telefono": "Teléfono de contacto"
    }
  }'
```

</details>

Se pueden fijar solo los que fallan: los demás se siguen resolviendo solos, y mandar uno
no borra los otros.

### Mapeo del formulario "Proceso de Inscripción"

Es el formulario estándar de la plataforma. Sus siete preguntas se resuelven bien por
heurística, pero conviene declarar el mapeo igual: así un renombre accidental falla
ruidosamente en vez de hacer que la IA reciba `no informado` sin que nadie se entere.

```bash
curl -X PUT https://tu-dominio.com/api/gyms/settings/google-form \
  -H "Authorization: Bearer <access-token-del-gym>" \
  -H "Content-Type: application/json" \
  -d '{
    "fieldMapping": {
      "nombre": "Nombre completo",
      "documento": "DNI",
      "telefono": "Numero de telefono",
      "edad": "Edad",
      "objetivo": "Objetivos con el entrenamiento",
      "lesiones": "Lesiones en curso",
      "diasPorSemana": "Cantidad de dias a la semana que podra entrenar"
    }
  }'
```

Los títulos van **exactamente** como están en el formulario, sin corregir la ortografía:
el CRM tolera diferencias de tildes y mayúsculas, pero no de redacción. Este formulario
no pregunta el email, así que `email` no se mapea y el campo del cliente queda como
estaba.

> ⚠️ **Si después renombrás una pregunta en el formulario, hay que actualizar el mapeo.**
> El CRM busca el título declarado y solo ese: si no lo encuentra, no vuelve a adivinar
> y la respuesta se rechaza con `400`.

---

## Qué pasa después

La ficha del socio queda con todas sus respuestas guardadas y con la fecha en que
completó la encuesta (que es lo que el tablero cuenta como conversión del embudo). Desde
el panel se le puede generar la rutina, que es donde la IA usa esas respuestas.

Si el mismo socio vuelve a completar el formulario, sus respuestas nuevas se **fusionan**
sobre las anteriores: contestar de nuevo solo la mitad de las preguntas no borra la otra
mitad. La fecha de conversión no se mueve — queda la de la primera vez.

Y si Google reenvía **la misma respuesta** (pasa cuando el CRM la recibió pero la
confirmación se perdió), el webhook la reconoce por su `responseId` y no la vuelve a
aplicar.

Para ver cómo viene funcionando la integración: `GET /api/onboarding/status` devuelve
cuántas submissions llegaron, cuántas se procesaron, cuántas rebotaron y con qué DNI.

---

## Si algo falla

Los errores quedan en el editor de Apps Script, en **Ejecuciones** (barra izquierda).
Google además manda un mail al dueño del formulario cuando un disparador falla.

| Qué dice el error                             | Qué pasó y cómo se arregla                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Faltan propiedades del script`                | El Paso 4 quedó incompleto o con un nombre mal escrito.                                                                        |
| `HTTP 401`                                     | El secreto no coincide. Rotarlo en el CRM y actualizar `CRM_WEBHOOK_SECRET`. También sale si el gimnasio nunca generó el suyo. |
| `HTTP 400`                                     | Falta el documento. O el formulario no lo pregunta, o el mapeo apunta a una pregunta que se renombró (Paso 8), o el gimnasio está desactivado. |
| El cliente entra con **datos cruzados**        | La heurística eligió mal la pregunta. Se corrige declarando el mapeo (Paso 8).                                                  |
| `HTTP 404` con `documento` en el detalle       | **No hay ningún socio con ese DNI.** El formulario no crea clientes: dar de alta al socio en el panel (o corregir el DNI) y reenviar la respuesta. |
| `HTTP 404` sin más detalle                     | La URL está mal. Tiene que terminar en `/api/onboarding/webhook`.                                                              |
| `HTTP 429`                                     | Se superaron las 100 respuestas cada 15 minutos por IP. El script reintenta solo.                                              |
| `El CRM no respondió después de 3 intentos`    | El backend está caído. La respuesta **no se pierde**: queda en el formulario y se puede cargar a mano desde el panel.          |
| Cada respuesta llega **dos veces**             | Hay disparadores duplicados. Ejecutar `instalarTrigger` otra vez: los limpia.                                                  |
| `No llegó el evento del formulario`            | Se ejecutó `onFormSubmit` a mano con el botón ▶. Para probar hay que usar `probarEnvio`.                                        |

---

## Nota para el equipo de desarrollo

- El script soporta las dos formas de instalar el disparador (sobre el **formulario**,
  usando `e.response`, o sobre la **hoja de respuestas** vinculada, usando
  `e.namedValues`) y normaliza ambas al mismo JSON. La guía usa la del formulario porque
  no requiere que exista una hoja.
- Los reintentos solo cubren `5xx` y `429`. Un `4xx` corta de inmediato: reintentar un
  secreto mal cargado o un gym dado de baja no lo va a arreglar.
- **Idempotencia por `responseId`.** El script manda el id que Google le da a la
  respuesta (`e.response.getId()`) y el backend lo guarda en `FormSubmissionRecord`, con
  índice único `(gymId, responseId)`. Un reenvío de una submission ya procesada devuelve
  la ficha sin volver a tocarla. Sobre la **hoja de respuestas** ese id no existe, así
  que se manda sin él: la submission se procesa igual —perder el dato es peor que perder
  la deduplicación— pero un reenvío se vuelve a aplicar. El índice usa
  `partialFilterExpression: { responseId: { $exists: true } }` y **no** `sparse`: en un
  índice compuesto, `sparse` solo excluye el documento si le faltan *todos* los campos
  indexados, y como `gymId` siempre está, las submissions sin id se indexarían con
  `null` y colisionarían entre sí.
- Un rechazo se **sobrescribe** al reprocesar, no se inserta de nuevo: reenviar la
  respuesta después de dar de alta al socio es la vía de recuperación prevista, y llega
  con el mismo `responseId`.
- `ProcessFormSubmissionUseCase` **no crea clientes**: busca por `documento` dentro del
  gym y lanza `NotFoundError` si no lo encuentra. Fue una decisión de producto, no una
  limitación: el onboarding es secuencial y una ficha fantasma con datos a medias
  ensuciaba la base y el embudo.
- Contrato del endpoint: ver `POST /api/onboarding/webhook` en
  `src/interfaces/http/routes/onboarding.routes.ts`.

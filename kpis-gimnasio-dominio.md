# KPIs de negocio para gimnasios — Lógica de dominio

Documentación de las métricas que alimentan el dashboard del CRM. Cada KPI se
describe con tres partes: **qué mide**, **la lógica por la que lo mide** (con el
benchmark de referencia para setear umbrales de alerta) y un **bloque TypeScript**
con la implementación base como función de dominio.

---

## Estado de implementación

El trabajo se dividió en 5 tandas. **Las tandas 1 a 4 están implementadas**; la 5
todavía no, y sus secciones en este documento quedan tal como se escribieron
originalmente.

| Tanda | Alcance                                                      | Estado          |
| ----- | ------------------------------------------------------------ | --------------- |
| 1     | Funciones puras de dominio (`src/domain/kpis/`)              | ✅ Implementada |
| 2     | Retención y financieros con datos reales (`MembershipEvent`) | ✅ Implementada |
| 3     | Engagement (`CheckIn`)                                       | ✅ Implementada |
| 4     | Embudo (§4, salvo §4.4)                                      | ✅ Implementada |
| 5     | Clases y capacidad (§2.3 y §5)                               | ⬜ Pendiente    |

Donde el código se apartó de lo que dice este documento, la sección correspondiente lo
aclara con el prefijo **Implementado:**. En esos puntos manda el código.

### Reglas de negocio que se definieron al implementar

No estaban en la versión original de este documento y gobiernan todo el cálculo:

- **La baja es el vencimiento sin renovación**, con **5 días de gracia**. Renovar dentro
  de la gracia es continuidad; después, la baja queda firme y una renovación posterior es
  una reactivación que se imputa al período en que ocurre. Nunca se reescribe un período
  cerrado.
- **`Client.estado: 'inactivo'` es borrado lógico**, no una baja de negocio. Esos socios
  se excluyen de todo cálculo.
- **Un lead es un `Client` sin `encuestaData`.** El onboarding es secuencial: se crea el
  cliente → paga → contesta la encuesta → recién ahí se le genera la planilla (el gate ya
  vive en `GenerateRoutineUseCase`). Como el pago va antes de la encuesta, un socio puede
  estar activo y pagando y seguir sin convertir.
- **Nada estimado.** Lo que no se sabe viaja como `null` hasta el dashboard. De ahí sale
  `getDataCutoff`: para períodos anteriores a que el historial fuera completo, los KPIs de
  retención devuelven `null` en vez de un número inventado.
- **Los ingresos salen de las renovaciones, no de las facturas AFIP**, porque la mayoría
  de los gyms no tiene la facturación activa y su ARPU habría dado 0.

### Estado de prueba

> **Al cerrar la tanda 4 (2026-08-08): 572 en verde y 1 en rojo**, sobre 52 archivos. El
> rojo es `dashboardKpis.test.ts > manda las fechas sin hora`, y es anterior a la tanda 4
> — ver "Deuda conocida". El embudo sumó 42 tests: 4 de dominio (`funnel.test.ts`), 6 del
> caso de uso de primer contacto, 4 del sello de conversión, 6 del bloque en
> `GetGymKpisUseCase`, 9 de integración contra Mongo y 13 e2e (`leadFunnel.test.ts`).

**421 tests en verde** (46 archivos). La verificación que faltaba se cerró con 92 tests
nuevos, que ejercitan la base y la API de verdad —Mongo en memoria y `supertest`— en vez
de mocks:

| Archivo                                                              | Tests | Qué cubre                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/integration/dashboard/MongoMetricsRepository.test.ts`         | 17    | El pipeline `$sort`/`$group`/`$lookup`: agrupación por socio, orden preservado, exclusión de eliminados y de eventos huérfanos, pesos → centavos, ventanas sin vencimiento, las tres ramas de `getDataCutoff`, aislamiento por gym. |
| `tests/integration/dashboard/MongoMembershipEventRepository.test.ts` | 12    | Que "no hubo cobro" ≠ "cobró cero" y "no consta el vencimiento" ≠ "no venció" sobrevivan a la base.                                                                                                                                 |
| `tests/integration/dashboard/seedMembershipEvents.test.ts`           | 11    | Armado de eventos, idempotencia por gym, gym nuevo tras una corrida previa, exclusión de eliminados, y que el corte quede en el instante de la siembra.                                                                             |
| `tests/integration/checkin/MongoCheckInRepository.test.ts`           | 11    | Recorte del día en `findByClientAndDay`, filtros, paginación, aislamiento.                                                                                                                                                          |
| `tests/e2e/dashboardKpis.test.ts`                                    | 28    | Contrato completo del endpoint, período por defecto, 400 de rango inválido, `null` antes del corte, churn/retención reales, y que alta, ajuste y renovación dejen su evento.                                                        |
| `tests/e2e/checkins.test.ts`                                         | 13    | Alta, idempotencia por día, 404 cross-tenant, 400 con socio eliminado, filtros y paginación.                                                                                                                                        |

Un hallazgo del camino: el escenario de dos socios (uno que vence el 01/02 y no renueva,
otro con vencimiento a fin de año) da churn 0.5 y retención 0.5 en febrero, con la baja
imputada al 06/02 por los 5 días de gracia. Es la regla de negocio verificada de punta a
punta, no solo en el dominio puro.

### Verificación contra la base real (2026-08-06)

La siembra se ejecutó sobre la base del proyecto y los endpoints se probaron contra el
servidor levantado, con GETs solamente. Resultado: **todo responde como se esperaba.**

De los 2 gyms cargados, uno tiene 1 cliente activo y el otro ninguno. El seed generó 1
evento `alta` de origen `historico`, con vencimiento y sin monto — el criterio de dato
real, tal cual. `GET /api/dashboard/kpis` devuelve `activos: 1` (sin la siembra sería 0,
que era justamente el punto), `GET /api/dashboard` devuelve el resumen, el rango
invertido y el `desde` suelto dan 400, sin token da 401, y el otro gym no ve nada del
primero.

Dos cosas que conviene tener presentes al mirar el dashboard, y que no son fallas:

- **`datosCompletosDesde` quedó en el instante de la siembra**, así que churn, retención
  y cohortes van a viajar en `null` un tiempo largo: la cohorte de 90 días recién dará un
  número pasados 90 días de socios nuevos. Es la regla de "nada estimado" funcionando,
  pero el front tiene que explicarlo o va a parecer que el tablero está roto.
- **Los KPIs de plata dan 0** porque el único cliente no tiene `historialRenovaciones`:
  no hay de dónde sacar ingresos ni MRR. Se llenan solos con la primera renovación
  hecha por el ABM.

Se verificó también que el stack trace que aparece en las respuestas de error solo se
incluye bajo `NODE_ENV === 'development'` (`errorHandler.ts`): en producción no se filtra.

**Lo que sigue sin verificar:**

- **`POST /api/onboarding/webhook` no tiene cobertura e2e.** Su emisión de evento sigue
  respaldada solo por tests unitarios; montar el webhook requiere firma y secreto del gym.
- **Las escrituras no se probaron contra la base real**, a propósito: alta, renovación y
  ajuste se verificaron e2e contra Mongo en memoria para no ensuciar los datos del
  gimnasio.
- **Se observó una corrida inestable.** En 1 de 8 ejecuciones de la suite completa
  fallaron 7 tests de 2 archivos, todos por datos ausentes (`datosCompletosDesde` en
  `null`). Aislados, esos archivos pasan siempre. Apunta a una carrera en la
  infraestructura de tests —46 archivos levantando cada uno su `MongoMemoryServer`— y no
  al código de producción, pero no está diagnosticado.

Para poder testear la siembra, `seed-membership-events.ts` se separó en dos: la lógica
(`sembrarEventosDeMembresia`, sobre una conexión ya abierta) y el arranque del proceso,
que corre solo bajo `require.main === module`.

> ⚠️ **`import 'dotenv/config'` va primero, antes que cualquier otro import.**
> `connectDatabase` arrastra `config/env`, que valida con zod en el momento de
> importarse. En CommonJS todos los imports se evalúan antes de la primera línea del
> arranque, así que cargar el `.env` dentro de `main()` llega tarde: zod valida un
> entorno vacío y el script muere con un `ZodError` —que además Node 25 no logra
> imprimir, y el error real queda tapado por un `TypeError` de `util/inspect`—. Se
> intentó mover ese import para que el test no tuviera efectos al importar el módulo, y
> rompió el comando. Verificar el script pasándole las variables a mano por la línea de
> comandos **no sirve**: enmascara exactamente esta falla.

### Deuda conocida

El helper `validateBody` / `validateQuery` está duplicado en cuatro archivos de rutas
(`client`, `onboarding`, `dashboard`, `checkin`). Corresponde extraerlo a un middleware
compartido.

> ⚠️ **`datosCompletosDesde` de `/dashboard/kpis/series`: el código y el contrato con el
> front dicen cosas distintas.** `BACKEND-requerimientos-dashboard.md` cerró que la serie
> devuelve `yyyy-MM-dd`, incluido ese campo, y que esa era "la única diferencia deliberada"
> con `/dashboard/kpis`. Después `DashboardController` unificó los dos endpoints en ISO
> completo, con un comentario que argumenta lo contrario. El test
> `dashboardKpis.test.ts:635` sigue exigiendo `yyyy-MM-dd` y por eso está en rojo.
>
> No se tocó al implementar la tanda 4: es un cambio de contrato de cara al front y hay
> que decidir de qué lado se resuelve, no elegir el que haga pasar el test.

---

## Convenciones de arquitectura

Estas funciones pertenecen a la **capa de dominio**. Reglas que se respetan en
todo el documento:

- **Pureza**: ninguna función hace I/O (ni DB, ni HTTP, ni reloj del sistema).
  Reciben datos ya materializados y devuelven un valor calculado. Esto las hace
  triviales de testear y las independiza del framework.
- **El tiempo se inyecta**: cuando un cálculo depende de "ahora", `now` entra como
  parámetro. Nunca se llama a `new Date()` dentro del dominio (determinismo).
- **Dinero como entero**: todos los montos van en la mínima unidad monetaria
  (centavos) como entero. Nunca `float` para dinero.
- **Tasas como fracción decimal** en `[0, 1]`. `0.05` = 5%. La capa de
  presentación formatea a porcentaje; el dominio no.
- **Denominador cero devuelve `null`**: "sin socios todavía" o "sin leads" es un
  estado de negocio válido, no un error. La tasa simplemente no está definida, y
  el tipo de retorno (`| null`) obliga a quien consume a manejar ese caso.

**Implementado:** las funciones viven en `src/domain/kpis/`, un módulo por bloque
(`retention`, `engagement`, `financial`, `funnel`, `operations`) más `types.ts` y
`membership.ts`. Dos aclaraciones sobre las convenciones de arriba:

- **La unidad de la base es el peso, no el centavo.** `Invoice.monto`,
  `historialRenovaciones[].monto` y `MembershipEvent.monto` guardan pesos, igual que
  siempre. La conversión ×100 la hace `MongoMetricsRepository` al leer; el dominio recibe
  centavos y no sabe que existió una conversión. No hubo migración de datos.
- **Los nombres de función quedaron en inglés** (los de este documento) y los de campo en
  español cuando espejan una entidad (`inicio`, `vencimiento`, `monto`). Es la convención
  mixta del repo.

### Ventanas de membresía y período de gracia

**Implementado** en `src/domain/kpis/membership.ts`. No estaba en la versión original de
este documento y es de lo que depende todo el bloque 1.

La vida de un socio no es un intervalo sino una secuencia de **ventanas** (`inicio` →
`vencimiento`) con huecos entre medio. Renovar dentro de los 5 días de gracia encadena la
ventana nueva a la anterior en un mismo tramo continuo; pasada la gracia, la baja queda
firme y la vuelta es una reactivación.

```typescript
export const DIAS_DE_GRACIA_POR_DEFECTO = 5;

export interface MembershipWindow {
  readonly inicio: Date;
  readonly vencimiento: Date;
}

/** Tres estados, no dos: `en_gracia` son los socios a los que hay que llamar hoy. */
export type MembershipStatus = 'vigente' | 'en_gracia' | 'de_baja';

membershipSegments(windows, diasDeGracia): MembershipSegment[]
churnDates(windows, diasDeGracia): Date[]        // vencimiento del tramo + gracia
reactivationDates(windows, diasDeGracia): Date[] // inicio de cada tramo salvo el primero
firstChurnDate(windows, at, diasDeGracia): Date | null
membershipStatusAt({ windows, at, diasDeGracia }): MembershipStatus
isActiveAt(windows, at, diasDeGracia): boolean   // el que está en gracia cuenta como socio
churnedDuring(windows, range, diasDeGracia): boolean
windowAt(windows, at): T | null                  // la cuota vigente, para el MRR
```

### Tipos compartidos

```typescript
/** Dinero en la mínima unidad monetaria (centavos), como entero. Nunca float. */
export type Cents = number;

/** Tasa expresada como fracción decimal en [0, 1]. 0.05 = 5%. */
export type Rate = number;

/** Rango temporal semiabierto [start, end). */
export interface DateRange {
  readonly start: Date;
  readonly end: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
```

---

## 1. Retención y churn — ✅ implementado (tandas 1 y 2)

Es el núcleo del negocio: adquirir un socio nuevo cuesta entre 5 y 7 veces más
que retener a uno actual, y mejorar la retención un 5% puede subir las ganancias
entre 25% y 95%.

**Implementado** en `src/domain/kpis/retention.ts`, alimentado por el stream
`MembershipEvent`. Los tres KPIs se exponen en `GET /api/dashboard/kpis` bajo
`retencion`, y devuelven `null` cuando el período empieza antes de que el historial sea
completo (`datosCompletosDesde`).

### 1.1 Churn rate mensual

**Qué mide.** El porcentaje de la base de socios que se da de baja dentro de un
mes.

**Lógica.** Bajas del período sobre la base al inicio del período. Es el indicador
rezagado más directo de la salud de la retención. Benchmark: 3–5% mensual es sano;
por debajo de 3% es excepcional; por encima de 7% indica estancamiento y hace
falta una intervención de retención.

```typescript
export function monthlyChurnRate(input: {
  membersAtStart: number;
  cancelledDuringPeriod: number;
}): Rate | null {
  const { membersAtStart, cancelledDuringPeriod } = input;
  if (membersAtStart <= 0) return null;
  return cancelledDuringPeriod / membersAtStart;
}
```

### 1.2 Tasa de retención anual

**Qué mide.** Qué proporción de los socios que había al inicio del período siguen
siendo socios al final.

**Lógica.** Se **excluyen las altas nuevas** del período: si no, un mes de mucha
adquisición inflaría la retención y escondería la fuga. Por eso la fórmula es
`(socios al final − altas nuevas) / socios al inicio`. Benchmark: 70–80% anual es
sano; por debajo de 60% es un "balde con fugas". Ojo con el segmento: boutique
ronda 65–70%, bajo costo 55–60%, gama media 58–65% — conviene comparar contra la
categoría, no contra un promedio global.

```typescript
export function retentionRate(input: {
  membersAtStart: number;
  membersAtEnd: number;
  newMembersInPeriod: number;
}): Rate | null {
  const { membersAtStart, membersAtEnd, newMembersInPeriod } = input;
  if (membersAtStart <= 0) return null;
  const retained = membersAtEnd - newMembersInPeriod;
  return retained / membersAtStart;
}
```

### 1.3 Retención por cohorte a N días

**Qué mide.** De los socios que se dieron de alta en un mismo período (una
cohorte), cuántos siguen activos pasados N días desde su alta.

**Lógica.** El churn agregado esconde el patrón real; la cohorte lo revela. La
ventana de 90 días es la más accionable porque es la del onboarding: quienes
alcanzan un hito temprano en los primeros 90 días tienen ~60% más de probabilidad
de quedarse. Un socio "sobrevive" a la ventana si a los N días de su alta todavía
no había cancelado.

> ⚠️ **Corrección.** La versión original de este documento afirmaba que `now` no se
> necesita. Es un error metodológico: sin él, un socio que se anotó hace 10 días cuenta
> como sobreviviente de una ventana de 90 días que todavía no transcurrió, y una cohorte
> joven se lee como retención perfecta. Con el mismo dato, la cohorte da 50% sin `now` y
> 0% con `now`.

**Implementado** con `now` opcional que **censura** las cohortes jóvenes: quien no
completó la ventana sale del numerador _y_ del denominador. `cancelledAt` es la
**primera** baja del socio, la que devuelve `firstChurnDate`, no la última.

```typescript
export interface CohortMember {
  readonly memberId: string;
  readonly joinedAt: Date;
  readonly cancelledAt: Date | null;
}

export function cohortRetention(input: {
  cohort: ReadonlyArray<CohortMember>;
  windowDays: number;
  now?: Date;
}): Rate | null {
  const { cohort, windowDays, now } = input;

  const evaluables =
    now === undefined
      ? cohort
      : cohort.filter((m) => diasEntre(m.joinedAt, now) >= windowDays);

  if (evaluables.length === 0) return null;

  const survivors = evaluables.filter((m) => {
    if (m.cancelledAt === null) return true; // nunca se fue
    return diasEntre(m.joinedAt, m.cancelledAt) >= windowDays;
  }).length;

  return survivors / evaluables.length;
}
```

En el endpoint la cohorte es **móvil**: entran solo las altas posteriores al corte de
datos que ya cumplieron los 90 días.

---

## 2. Engagement y uso — ✅ 2.1 y 2.2 implementados (tanda 3) · ⬜ 2.3 pendiente

Los mejores predictores adelantados de churn. Son, además, los que el CRM puede
automatizar mejor (triggers de intervención).

**Implementado** en `src/domain/kpis/engagement.ts`, alimentado por la entidad `CheckIn`
(`POST /api/checkins`). Se exponen en `GET /api/dashboard/kpis` bajo `engagement`.

Una regla que no estaba en este documento y resultó necesaria: **las dos métricas se
acotan a la ventana en la que efectivamente hubo registro de asistencia**. El día que se
activa el módulo nadie tiene check-ins, así que todos los socios calificarían como "hace
dos semanas que no vienen" — un artefacto del sistema, no una verdad sobre el gimnasio.
Por eso el endpoint expone `registroDesde`, deja `enRiesgo` en `null` hasta tener 14 días
de registro, y calcula la frecuencia solo sobre los días registrados.

2.3 (participación en clases) queda para la tanda 5: necesita la entidad de clases.

### 2.1 Frecuencia de visita

**Qué mide.** Promedio de visitas por socio por semana en un período.

**Lógica.** Es el predictor de churn más fuerte: quien va 2+ veces por semana
tiene la mitad de probabilidad de cancelar que quien va una vez o menos; 8+
visitas al mes marca a los socios sólidos. Se normaliza por semana para que sea
comparable entre períodos de distinta longitud.

```typescript
export function avgVisitsPerMemberPerWeek(input: {
  totalCheckIns: number;
  activeMembers: number;
  periodDays: number;
}): number | null {
  const { totalCheckIns, activeMembers, periodDays } = input;
  if (activeMembers <= 0 || periodDays <= 0) return null;
  const weeks = periodDays / 7;
  return totalCheckIns / activeMembers / weeks;
}
```

### 2.2 Socios en riesgo / fantasma

**Qué mide.** Los socios sin actividad reciente, candidatos a una intervención
proactiva antes de que cancelen.

**Lógica.** Un socio que no registra ingreso en dos semanas es un riesgo alto de
churn. Esta función devuelve los IDs para que la capa de aplicación dispare la
campaña (mensaje automático, oferta, llamada). `now` se inyecta para mantener la
pureza. Un socio que nunca asistió (`lastCheckInAt === null`) es riesgo por
definición.

```typescript
export interface MemberActivity {
  readonly memberId: string;
  readonly lastCheckInAt: Date | null;
}

export function findAtRiskMembers(input: {
  members: ReadonlyArray<MemberActivity>;
  staleDays: number;
  now: Date;
}): ReadonlyArray<string> {
  const { members, staleDays, now } = input;
  return members
    .filter((m) => {
      if (m.lastCheckInAt === null) return true;
      const daysSince =
        (now.getTime() - m.lastCheckInAt.getTime()) / MS_PER_DAY;
      return daysSince >= staleDays;
    })
    .map((m) => m.memberId);
}
```

### 2.3 Participación en clases — ⬜ pendiente (tanda 5)

**Qué mide.** Qué proporción de los socios activos asistió al menos a una clase
grupal en la semana.

**Lógica.** El 85% de quienes asisten a al menos una clase por semana siguen
siendo socios un año o más. Es una palanca de retención medible: si el número
baja, el churn de los próximos meses probablemente suba.

```typescript
export function weeklyClassParticipationRate(input: {
  membersWithClassAttendance: number;
  activeMembers: number;
}): Rate | null {
  const { membersWithClassAttendance, activeMembers } = input;
  if (activeMembers <= 0) return null;
  return membersWithClassAttendance / activeMembers;
}
```

---

## 3. Financieros — ✅ 3.1 a 3.3 implementados (tanda 2) · ⬜ 3.4 a 3.6 fuera de alcance

**Implementado** en `src/domain/kpis/financial.ts`. Se exponen en
`GET /api/dashboard/kpis` bajo `financiero`.

**CAC (3.4), ratio LTV:CAC (3.5) y payback (3.6) no se implementaron**, por decisión
explícita: los tres necesitan el gasto de ventas y marketing del período, un dato que no
existe en ninguna entidad y que exige modelar el flujo de trabajo de cada gym. Sus
funciones tampoco están escritas; sus secciones quedan tal cual como especificación.

Por el mismo motivo el margen bruto no se calcula: `lifetimeValue` acepta el parámetro
pero, mientras no se pase, devuelve **LTV sobre ingreso y no sobre beneficio** — que es
una lectura distinta y conviene rotularla como tal en el dashboard.

### 3.1 MRR y su descomposición

**Qué mide.** El ingreso recurrente mensual, y —más importante— **por qué** se
movió respecto del mes anterior.

**Lógica.** El MRR total es la suma de las cuotas recurrentes activas normalizadas
a base mensual (un plan anual entra como `cuotaAnual / 12`). La descomposición en
nuevo / expansión / contracción / churn es lo que convierte un número en un
diagnóstico: dice si el crecimiento viene de adquirir, de hacer upsell o de tapar
bajas.

```typescript
export interface MrrMovement {
  readonly newMrr: Cents; // altas nuevas
  readonly expansionMrr: Cents; // upgrades y reactivaciones
  readonly contractionMrr: Cents; // downgrades
  readonly churnedMrr: Cents; // bajas
}

/** MRR total = suma de cuotas recurrentes activas, normalizadas a mensual. */
export function mrr(
  activeSubscriptions: ReadonlyArray<{ monthlyFee: Cents }>,
): Cents {
  return activeSubscriptions.reduce((sum, s) => sum + s.monthlyFee, 0);
}

/** Variación neta de MRR en el período, descompuesta por origen. */
export function netMrrGrowth(m: MrrMovement): Cents {
  return m.newMrr + m.expansionMrr - m.contractionMrr - m.churnedMrr;
}
```

**Implementado:** se agregó `normalizeToMonthlyFee`, que no estaba en este documento y es
lo que vuelve calculable el MRR **sin necesidad de una entidad `Plan`**. La cuota de un
socio es lo que pagó dividido por lo que duró su ventana, así que un pago trimestral de
$30.000 entra al MRR como $10.000. Sale directo del modelo de ventanas.

```typescript
export function normalizeToMonthlyFee(input: {
  monto: Cents;
  inicio: Date;
  vencimiento: Date;
}): Cents | null {
  const { monto, inicio, vencimiento } = input;
  const dias = diasEntre(inicio, vencimiento);
  if (dias <= 0) return null;
  return Math.round(monto / (dias / DIAS_POR_MES));
}
```

`netMrrGrowth` existe pero **todavía no se expone en el endpoint**: descomponer el
movimiento en nuevo / expansión / contracción / churn requiere comparar montos entre
ventanas consecutivas, y eso se resuelve cuando haya historial suficiente después de la
siembra.

### 3.2 ARPU / ARPM

**Qué mide.** Ingreso mensual promedio por socio.

**Lógica.** MRR (o ingreso mensual total) dividido por socios activos. Si en
`monthlyRevenue` incluís solo cuotas, obtenés ARPU; si sumás extras (PT, retail,
drop-ins), obtenés ARPM, que revela cuánto estás diversificando ingresos más allá
de la membresía. Se redondea a centavos enteros.

```typescript
export function arpu(input: {
  monthlyRevenue: Cents;
  activeMembers: number;
}): Cents | null {
  const { monthlyRevenue, activeMembers } = input;
  if (activeMembers <= 0) return null;
  return Math.round(monthlyRevenue / activeMembers);
}
```

### 3.3 LTV (valor de vida del cliente)

**Qué mide.** Cuánto beneficio aporta un socio a lo largo de toda su relación con
el gimnasio.

**Lógica.** La vida media de un socio es `1 / churn mensual`, así que
`LTV = ARPU × margen / churn`. Es la métrica que justifica cuánto podés gastar en
adquirir. El insight clave: **reducir el churn a la mitad duplica el LTV** — por
eso el churn aparece en el denominador. Si `grossMargin` no se pasa, se asume 1
(100%) y el resultado es LTV sobre ingreso, no sobre beneficio. Con churn 0 el LTV
tiende a infinito, así que se devuelve `null`.

```typescript
export function lifetimeValue(input: {
  arpu: Cents;
  monthlyChurnRate: Rate;
  grossMargin?: Rate; // [0,1]; por defecto 1
}): Cents | null {
  const { arpu, monthlyChurnRate } = input;
  const grossMargin = input.grossMargin ?? 1;
  if (monthlyChurnRate <= 0) return null;
  return Math.round((arpu * grossMargin) / monthlyChurnRate);
}
```

### 3.4 CAC (costo de adquisición) — ⬜ no implementado

**Qué mide.** Cuánto cuesta, en promedio, sumar un socio nuevo.

**Lógica.** Todo el gasto de ventas y marketing del período dividido por los
socios nuevos que ese gasto trajo. Solo tiene sentido leído junto al LTV (ver
3.5) y al payback (ver 3.6).

```typescript
export function customerAcquisitionCost(input: {
  salesAndMarketingSpend: Cents;
  newMembersAcquired: number;
}): Cents | null {
  const { salesAndMarketingSpend, newMembersAcquired } = input;
  if (newMembersAcquired <= 0) return null;
  return Math.round(salesAndMarketingSpend / newMembersAcquired);
}
```

### 3.5 Ratio LTV:CAC — ⬜ no implementado

**Qué mide.** Cuántos pesos de valor de vida genera cada peso invertido en
adquirir.

**Lógica.** El indicador de salud del negocio por excelencia para una auditoría.
Benchmark: 3:1 o más es sano; por debajo de 2:1 el costo de adquisición es muy
alto o la retención está floja; los mejores gimnasios llegan a 5:1 o más. Devuelve
el múltiplo (p. ej. 3.5), no una tasa.

```typescript
export function ltvToCacRatio(input: {
  ltv: Cents;
  cac: Cents;
}): number | null {
  const { ltv, cac } = input;
  if (cac <= 0) return null;
  return ltv / cac;
}
```

### 3.6 Periodo de recuperación de CAC (payback) — ⬜ no implementado

**Qué mide.** Cuántos meses tarda un socio en devolver, vía su margen mensual, lo
que costó adquirirlo.

**Lógica.** `CAC / (ARPU × margen)`. Regla común en negocios de suscripción:
recuperar el CAC en 12 meses o menos. Cruzado con la vida media (`1 / churn`), te
dice cuántos meses de beneficio real queda después de amortizar la adquisición.

```typescript
export function cacPaybackMonths(input: {
  cac: Cents;
  arpu: Cents;
  grossMargin?: Rate; // [0,1]; por defecto 1
}): number | null {
  const { cac, arpu } = input;
  const grossMargin = input.grossMargin ?? 1;
  const monthlyMargin = arpu * grossMargin;
  if (monthlyMargin <= 0) return null;
  return cac / monthlyMargin;
}
```

---

## 4. Adquisición y embudo — ✅ implementado (tanda 4), salvo §4.4

Indicadores adelantados: predicen el ingreso con semanas de anticipación.

> **Estado.** El bloque `embudo` sale en `GET /api/dashboard/kpis`. Los dos campos que
> faltaban viven en `Client`: `fechaConversion` (sellado la primera vez que aparece
> `encuestaData`, por cualquiera de los tres caminos: `POST /api/clients`, `PATCH
/api/clients/:id/encuesta` y el webhook del Form) y `fechaPrimerContacto` (lo graba
> `POST /api/clients/:id/contacto`, que es idempotente).
>
> **Implementado:** el bloque expone dos lecturas que conviene no confundir.
>
> - **Conteos crudos del período** (`leadsNuevos`, `leadsPorSemana`,
>   `conversionesEnPeriodo`, `sinConvertir`, `sinContactar`): siempre tienen valor.
> - **`tasaConversion`, de cohorte y censurada** a `ventanaConversionDias` (90). Viene en
>   `null` para el período por defecto y **eso es correcto**: ningún lead del mes en curso
>   cumplió la ventana, y contarlo como no convertido leería el embudo peor de lo que es.
>   Mismo criterio que `cohortRetention` en §1.3.
>
> Tres cosas más que hay que tener presentes al leerlo:
>
> - **Ojo con el sentido del embudo.** `ProcessFormSubmissionUseCase` guarda `encuestaData`
>   con las respuestas del Form, así que **quien entra por Google Forms ya cuenta como
>   convertido**; los leads son los cargados a mano por `POST /api/clients` sin encuesta.
>   Es al revés de lo que sugiere la intuición.
> - **El benchmark de 30–50% de §4.2 no aplica tal cual.** En este CRM el pago ocurre
>   _antes_ de la encuesta, así que la conversión mide compleción del onboarding, no
>   conversión a socio que paga.
> - **Los clientes anteriores a esta tanda cuentan como convertidos sin fecha.** Tienen
>   `encuestaData` pero no `fechaConversion`: convirtieron de verdad y nadie registró
>   cuándo. Entran en la tasa de cohorte y NO en `conversionesEnPeriodo`, que se imputa por
>   fecha. No se hizo backfill con `updatedAt` a propósito — sería dato inventado con cara
>   de dato real, y viola la regla de "nada estimado" que rige el resto del tablero.
> - **Los trials (§4.4) siguen sin modelarse** en ninguna parte, así que
>   `trialConversionRate` y `trialConversionByVisits` siguen sin exponerse.

### 4.1 Leads nuevos por semana — ✅ implementado (tanda 4)

**Qué mide.** Cuántos prospectos nuevos entran al embudo por semana.

**Lógica.** El indicador más adelantado de todos: los leads preceden a las
pruebas, que preceden a las altas, que preceden al ingreso. Si los leads caen esta
semana, el ingreso cae en 6–10 semanas. Benchmark boutique: 5–15 por semana. Se
normaliza por semana.

```typescript
export function newLeadsPerWeek(input: {
  leadsInPeriod: number;
  periodDays: number;
}): number | null {
  const { leadsInPeriod, periodDays } = input;
  if (periodDays <= 0) return null;
  return leadsInPeriod / (periodDays / 7);
}
```

### 4.2 Conversión lead→socio — ✅ implementado (tanda 4)

**Qué mide.** Qué proporción de los leads termina convirtiéndose en socio que
paga.

**Lógica.** Mide la efectividad del proceso comercial. Benchmark sano para
walk-ins o consultas web: 30–50%. Definí bien la ventana (típicamente 90 días
desde la creación del lead) para no contar como "no convertidos" a leads todavía
en proceso.

```typescript
export function leadConversionRate(input: {
  convertedMembers: number;
  totalLeads: number;
}): Rate | null {
  const { convertedMembers, totalLeads } = input;
  if (totalLeads <= 0) return null;
  return convertedMembers / totalLeads;
}
```

### 4.3 Tiempo de respuesta al lead — ✅ implementado (tanda 4)

**Qué mide.** Cuánto tarda el gimnasio en contactar por primera vez a un lead
nuevo.

**Lógica.** Impacta directamente la conversión: la respuesta rápida es una de las
palancas más baratas del embudo. Se promedia solo sobre los leads efectivamente
contactados; los no contactados son un problema aparte (cobertura, no velocidad).
Devuelve minutos.

```typescript
export interface LeadContact {
  readonly createdAt: Date;
  readonly firstContactedAt: Date | null;
}

export function avgLeadResponseMinutes(
  leads: ReadonlyArray<LeadContact>,
): number | null {
  const contacted = leads.filter((l) => l.firstContactedAt !== null);
  if (contacted.length === 0) return null;
  const MS_PER_MIN = 60 * 1000;
  const totalMinutes = contacted.reduce((sum, l) => {
    return (
      sum + (l.firstContactedAt!.getTime() - l.createdAt.getTime()) / MS_PER_MIN
    );
  }, 0);
  return totalMinutes / contacted.length;
}
```

### 4.4 Conversión trial→pago — ⬜ pendiente (trials sin modelar)

**Qué mide.** Qué proporción de las pruebas termina en membresía paga, y cómo
cambia según el uso durante la prueba.

**Lógica.** El dato accionable: asistir 3+ veces durante la prueba **duplica** la
probabilidad de conversión. Por eso conviene medir no solo la conversión global
(`trialConversionRate`) sino la conversión **segmentada por visitas durante el
trial** (`trialConversionByVisits`), que expone el umbral de visitas que dispara
la conversión y le dice al CRM a qué trials empujar.

```typescript
export function trialConversionRate(input: {
  convertedTrials: number;
  totalTrials: number;
}): Rate | null {
  const { convertedTrials, totalTrials } = input;
  if (totalTrials <= 0) return null;
  return convertedTrials / totalTrials;
}

export interface TrialOutcome {
  readonly visitsDuringTrial: number;
  readonly converted: boolean;
}

/** Conversión de los trials con al menos `minVisits` visitas. Revela el umbral. */
export function trialConversionByVisits(
  trials: ReadonlyArray<TrialOutcome>,
  minVisits: number,
): Rate | null {
  const segment = trials.filter((t) => t.visitsDuringTrial >= minVisits);
  if (segment.length === 0) return null;
  const converted = segment.filter((t) => t.converted).length;
  return converted / segment.length;
}
```

### 4.5 Crecimiento neto de socios — ✅ implementado (tanda 2)

**Qué mide.** Altas menos bajas en el período.

**Lógica.** Un gimnasio que suma 8 y pierde 8 no crece; el conteo bruto de altas
lo esconde. Se muestra explícito para que el estancamiento sea visible.

```typescript
export function netMemberGrowth(input: {
  newMembers: number;
  churnedMembers: number;
}): number {
  return input.newMembers - input.churnedMembers;
}
```

---

## 5. Operacionales y capacidad — ⬜ pendiente (tanda 5)

> **Estado.** Las funciones puras existen en `src/domain/kpis/operations.ts` desde la
> tanda 1, pero ninguna se expone: faltan las entidades `GymClass` y `ClassBooking`, que
> son el alcance de la tanda 5 junto con §2.3.
>
> Para §5.1 se decidió **no** crear entidad: la capacidad y las franjas pico van como
> configuración del gym, y los slots usados salen de los `CheckIn` que ya se registran.

### 5.1 Utilización de instalación

**Qué mide.** Qué fracción de la capacidad disponible se está usando, típicamente
en horas pico.

**Lógica.** En horas pico (6–9 AM y 5–8 PM), por encima de 60–70% puede indicar
necesidad de expansión; por debajo de 40%, capacidad ociosa que conviene llenar
con programación nueva o usar para reducir costos. El overhead fijo no cambia con
la ocupación, así que este número toca directo el margen.

```typescript
export function facilityUtilizationRate(input: {
  slotsUsed: number;
  slotsAvailable: number;
}): Rate | null {
  const { slotsUsed, slotsAvailable } = input;
  if (slotsAvailable <= 0) return null;
  return slotsUsed / slotsAvailable;
}
```

### 5.2 Ocupación de clases

**Qué mide.** Qué porcentaje de los cupos de las clases se llena, en promedio
ponderado.

**Lógica.** Mide el ROI de cada horario de clase. Se pondera por capacidad (no un
promedio simple de porcentajes) para que una clase grande pese más que una chica.
Un slot lleno de forma consistente justifica duplicar sesión; uno vacío se está
comiendo margen.

```typescript
export interface ClassSession {
  readonly attendees: number;
  readonly capacity: number;
}

export function classOccupancyRate(
  sessions: ReadonlyArray<ClassSession>,
): Rate | null {
  const totalCapacity = sessions.reduce((s, c) => s + c.capacity, 0);
  if (totalCapacity <= 0) return null;
  const totalAttendees = sessions.reduce((s, c) => s + c.attendees, 0);
  return totalAttendees / totalCapacity;
}
```

### 5.3 Tasa de no-show

**Qué mide.** Qué proporción de las reservas no se cumple.

**Lógica.** Cada no-show es capacidad desperdiciada y una señal de a quién hacer
seguimiento. Patrones por horario (p. ej. PT de la tarde con más ausencias que el
de la mañana) permiten ajustar políticas de reserva.

```typescript
export function noShowRate(input: {
  noShows: number;
  totalBookings: number;
}): Rate | null {
  const { noShows, totalBookings } = input;
  if (totalBookings <= 0) return null;
  return noShows / totalBookings;
}
```

---

## Cómo encaja en la arquitectura

Las funciones de arriba son **dominio puro**: no saben de base de datos ni de
HTTP. La orquestación vive en la **capa de aplicación** (un caso de uso), que
depende de un **puerto** (interfaz) y no de una implementación concreta de
repositorio. El adaptador de infraestructura implementa ese puerto contra tu DB.

**Implementado:** el puerto es `IMetricsRepository` (`src/domain/repositories/`) y el
caso de uso es `GetGymKpisUseCase`, que no tiene ni una fórmula propia. Difiere del
boceto original en dos cosas, y vale entender por qué:

**El puerto devuelve datos, no números ya agregados.** La regla que define quién es socio
—las ventanas encadenadas con 5 días de gracia— vive en `membership.ts`. Si el conteo se
resolviera con pipelines de agregación, esa regla quedaría escrita dos veces: una en el
dominio y otra en un pipeline que nadie puede testear sin base de datos. El costo es
traer el historial del gym a memoria, despreciable para cientos de socios. Si algún día
un tenant lo hace pesar, el reemplazo es un read-model materializado detrás del mismo
puerto, sin tocar dominio ni caso de uso.

**No hay `countActiveMembers(range)`.** El boceto lo llamaba con
`{ start: range.start, end: range.start }` — un rango vacío para pedir un conteo puntual,
que es la señal de que el método que hacía falta era otro. El conteo puntual se resuelve
con `isActiveAt(windows, fecha)` en el dominio.

```typescript
// ---- Puerto: materializa el historial, no lo interpreta ----
export interface IMetricsRepository {
  getMembershipHistories(gymId: string): Promise<ClientMembershipHistory[]>;
  getDataCutoff(gymId: string): Promise<Date | null>;
  countCheckIns(gymId: string, range: DateRange): Promise<number>;
  getLastCheckInByClient(gymId: string): Promise<MemberLastCheckIn[]>;
  getFirstCheckInDate(gymId: string): Promise<Date | null>;
}

// ---- Caso de uso: compone datos + dominio ----
const membersAtStart = historiales.filter((h) =>
  isActiveAt(h.windows, periodo.start),
).length;
const bajas = historiales.filter((h) =>
  churnedDuring(h.windows, transcurrido),
).length;
const churn = monthlyChurnRate({
  membersAtStart,
  cancelledDuringPeriod: bajas,
});
```

Un detalle que no era obvio: **el período en curso se corta en `now`**. Si se piden los
KPIs de marzo un 15 de marzo, el rango efectivo va del 1 al 15. Sin ese corte, todo socio
cuyo vencimiento cae el 20 se contaría hoy como baja, y el churn se inflaría con gente
que simplemente todavía no venció.

### Nota sobre el modelo de datos

Casi todos estos KPIs son **derivados, no almacenados**. Lo que conviene persistir
como eventos crudos con buen timestamp es acotado: eventos de membresía (alta,
baja, upgrade/downgrade, pausa, reactivación), check-ins/asistencia, eventos del
embudo (creación de lead, fuente, cambios de etapa, visitas durante el trial) y
transacciones (cuota + extras). De esos cuatro streams se derivan todas las
métricas por query o read-model, y el churn predictivo aparece al cruzarlos.

**Estado de los cuatro streams:**

| Stream                 | Entidad                             | Estado     |
| ---------------------- | ----------------------------------- | ---------- |
| Eventos de membresía   | `MembershipEvent`                   | ✅ tanda 2 |
| Check-ins / asistencia | `CheckIn`                           | ✅ tanda 3 |
| Transacciones          | `MembershipEvent.monto` + `Invoice` | ✅ tanda 2 |
| Embudo                 | —                                   | ⬜ tanda 4 |

**Por qué hizo falta `MembershipEvent`.** `Client.historialRenovaciones` guarda
`{ fecha, monto }` y **no** a qué vencimiento llevó cada renovación. Sin ese dato es
imposible responder "¿cuántos socios activos había el 1 de marzo?" hacia atrás: solo se
conoce la ventana vigente. El stream de eventos lo resuelve, y de paso vuelve calculable
el MRR sin inventar una entidad `Plan`.

**La baja no es un evento de ese stream**, porque nadie la dispara: se deriva de las
ventanas. Los eventos son `alta`, `renovacion` y `ajuste` (este último para cuando alguien
mueve `fechaVencimiento` a mano desde el ABM, que corre la ventana sin cobro de por medio
y hay que dejar auditado).

### Nota sobre la siembra inicial

`npm run seed:membership-events` reconstruye el stream a partir de los clientes ya
cargados, y la línea que traza es la que gobierna todo el criterio del dashboard: **dato
real o nada**.

- La **ventana vigente** se siembra completa: `fechaInicio` (o la última renovación) y la
  `fechaVencimiento` actual son ambos datos reales. Sin esto, el día del deploy el
  dashboard marcaría 0 socios activos y los socios irían apareciendo de a uno a medida que
  renovaran — un mes entero de números mal.
- Las **renovaciones pasadas** se siembran con su fecha y su monto, pero **sin
  vencimiento**, porque ese dato nunca se guardó. No dibujan ventana, así que habilitan la
  historia real de ingresos sin inventar churn.

El resultado: los KPIs de plata tienen historia desde el día uno, y los de retención
arrancan vacíos y se llenan solos con el uso. `getDataCutoff` es lo que marca la frontera,
y todo lo que cae del lado equivocado viaja como `null` hasta el dashboard.

### Nota sobre los benchmarks

Los umbrales citados provienen mayormente de mercados de EE. UU. y Europa y de
segmentos específicos (boutique, bajo costo, etc.). Para un gimnasio local
conviene tratarlos como rangos de referencia configurables por el propio gimnasio,
no como constantes en el código.

# Auditar y refactorizar

Dos tareas hermanas: **diagnosticar** el estado de la arquitectura y **corregir** acoplamientos sin
romper nada. Ambas exigen entender el flujo real antes de opinar o mover código.

## Auditar arquitectura

Objetivo: un diagnóstico priorizado por impacto que un desarrollador pueda accionar, no un checklist
mecánico. Trabaja así:

1. **Mapea el flujo de al menos un recurso de punta a punta**: ruta → controller → caso de uso →
   puerto → adaptador. Esto revela si el wiring y la dirección de dependencias son sanos en la práctica,
   no solo en la estructura de carpetas.
2. **Verifica la regla de dependencias con búsquedas concretas.** Las violaciones más graves y fáciles
   de detectar:
   - `application/` o `domain/` importando de `infrastructure/` → inversión de dependencias rota.
     Busca imports de `infrastructure`, `mongoose`, `express`, `axios`, SDKs de vendors dentro de esas
     capas.
   - Casos de uso recibiendo clases concretas (`MongoXRepository`) en vez de puertos (`IXRepository`).
   - Tipos del vendor (p. ej. tipos de OpenAI/Mongoose) filtrándose a través de un puerto del dominio.
3. **Revisa el aislamiento multi-tenant.** Cualquier query de repositorio o handler que no filtre por
   `gymId` es un hallazgo de seguridad de alta prioridad, no de estilo.
4. **Revisa el manejo de errores.** Respuestas `res.status(...)` ad-hoc con lógica de negocio dispersa
   en vez de lanzar clases de `shared/errors/AppError` y delegar en el `errorHandler`.
5. **Cohesión y duplicación.** Casos de uso que hacen demasiado; helpers repetidos entre archivos
   (p. ej. `validateBody` copiado en cada `*.routes.ts`); mappers duplicados.

### Formato del diagnóstico

Ordena por impacto (seguridad/corrección primero, estilo al final). Para cada hallazgo:

```
### [Severidad] Título corto
- **Dónde:** ruta/al/archivo.ts:línea
- **Qué viola:** principio concreto (regla de dependencias / aislamiento tenant / SRP / ...)
- **Por qué importa:** consecuencia real (bug potencial, fuga de datos entre gyms, deuda técnica)
- **Cómo corregir:** el arreglo en el estilo del proyecto (con nombre de puerto/capa destino)
```

Cierra con un resumen de 3-5 líneas: salud general y las 2-3 acciones de mayor retorno.

## Refactorizar hacia hexagonal

Cuando un módulo está acoplado (p. ej. un controller que habla directo con Mongoose, o un caso de uso
que importa un SDK), el refactor sigue esta secuencia para **no romper compilación ni tests en ningún
paso intermedio**:

1. **Caracteriza el comportamiento actual.** Si no hay test que cubra la lógica que vas a mover,
   escríbelo primero contra el comportamiento existente (ver `testing.md`). Es tu red de seguridad.
2. **Extrae el puerto.** Define el `IXRepository` / `IXProvider` en `domain/` que describe lo que el
   código acoplado necesita, en términos del dominio.
3. **Mueve la implementación concreta** a un adaptador en `infrastructure/` que implemente el puerto.
   Traduce ahí cualquier tipo o error del vendor.
4. **Reescribe la lógica** para depender del puerto por constructor, no de la clase concreta.
5. **Recablea** en el composition root (`*.routes.ts`): instancia el adaptador y pásalo.
6. **Verifica en cada paso** que `npx tsc --noEmit`, `npm run lint` y `npm test` siguen en verde.
   Un refactor que rompe el build a mitad no es "en progreso", es un cambio incorrecto que hay que
   dividir en pasos más pequeños.

### Reglas de oro del refactor

- **No cambies comportamiento y estructura a la vez.** Primero mueve/desacopla con el comportamiento
  idéntico y los tests en verde; si además hay que corregir un bug, hazlo en un cambio aparte y claramente
  señalado.
- **Preserva las firmas públicas** (rutas HTTP, forma de respuesta) salvo que el objetivo explícito sea
  cambiarlas. El frontend depende de ellas.
- **Respeta el idioma mixto y las convenciones** del resto del código (ver SKILL.md). El refactor debe
  volverse invisible: el resultado tiene que parecer que siempre estuvo así.

/**
 * Zona horaria del gimnasio y cortes de día calendario.
 *
 * Existe porque el backend tenía tres formas distintas de decidir "qué día es un
 * instante", y ninguna era la del gimnasio: `new Date(y, m, d)` y `setHours(0,0,0,0)`
 * cortan en la hora local del PROCESO Node, así que el mismo request daba un
 * resultado en un contenedor con `TZ=UTC` y otro en una máquina argentina. No era
 * que una de las dos zonas estuviera mal: era que el resultado dependía de dónde
 * corriera el server.
 *
 * La regla que separa los dos casos, y que gobierna todo este módulo:
 *
 *  - **Los períodos de KPI se cortan en UTC** (ver `GetGymKpisUseCase`). Es el
 *    contrato que el front asumió, y sobre un agregado de 30 días la diferencia
 *    contra la hora local son tres horas en el borde.
 *  - **El día calendario se corta en la zona del gimnasio.** Acá la hora ES el dato:
 *    un ingreso a las 21:30 de un lunes argentino es del lunes, y agrupado en UTC
 *    cae en el martes. Eso rompe la idempotencia diaria del check-in y corre el mapa
 *    de calor tres franjas.
 *
 * No es una incoherencia: son dos preguntas distintas.
 *
 * Sin dependencias: todo sale de `Intl`, que ya trae la base de datos IANA con sus
 * reglas de horario de verano. Una librería de fechas acá sería peso muerto.
 */

import { DateRange, MS_POR_DIA } from '../kpis/types';

/**
 * Zona con la que se interpreta un gym que no configuró la suya.
 *
 * Es un default, no una verdad: por eso los endpoints que agrupan por hora la
 * devuelven en la respuesta (`zonaHoraria`), para que el front pueda rotular el eje
 * con lo que efectivamente se usó en vez de asumirlo. Vive acá y en ningún otro
 * lado — repetirlo dentro de un pipeline de agregación es cómo se desincronizan
 * estas cosas.
 */
export const ZONA_HORARIA_DEFAULT = 'America/Argentina/Buenos_Aires';

/**
 * Si la zona existe en la base IANA que trae el runtime.
 *
 * Se valida en el borde HTTP y no al usarla: un nombre inválido hace que Mongo
 * aborte el `$dateToParts` del mapa de calor en runtime, y un 500 al pedir una
 * gráfica es un pésimo lugar para enterarse de que alguien tipeó mal la
 * configuración del gym hace tres semanas.
 */
export function esZonaHorariaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

interface ParteFecha {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** El reloj de pared de esa zona en ese instante, descompuesto. */
function partesEn(instante: Date, zona: string): ParteFecha {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    // `hourCycle: 'h23'` y no `hour12: false`: el segundo devuelve la hora 24 para
    // la medianoche en varias implementaciones, y 24 desborda el cálculo del día.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const valor = (tipo: string): number =>
    Number(partes.find((p) => p.type === tipo)?.value ?? 0);

  return {
    year: valor('year'),
    month: valor('month'),
    day: valor('day'),
    hour: valor('hour'),
    minute: valor('minute'),
    second: valor('second'),
  };
}

/**
 * Cuánto se corre esa zona respecto de UTC en ese instante, en milisegundos.
 *
 * El truco: se formatea el instante en la zona pedida y se reinterpreta ese reloj de
 * pared como si fuera UTC. La diferencia contra el instante original ES el offset.
 * Sale del propio `Intl`, así que el horario de verano ya viene contemplado.
 */
function offsetEnMs(instante: Date, zona: string): number {
  const p = partesEn(instante, zona);
  const comoSiFueraUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);

  // Los milisegundos no los devuelve `Intl`; se recuperan del instante original para
  // que la resta dé el offset exacto y no un offset con hasta 999 ms de ruido.
  return comoSiFueraUtc - (instante.getTime() - instante.getMilliseconds());
}

/**
 * El instante real en el que arranca ese día calendario en esa zona.
 *
 * Se resuelve en dos pasadas a propósito. El offset se conoce recién cuando se sabe
 * de qué instante se habla, y acá se busca justamente el instante — así que la
 * primera pasada usa un offset aproximado para ubicarse en el día y la segunda lo
 * recalcula ya parada ahí. Sin eso, una medianoche del día en que cambia el horario
 * de verano queda corrida una hora. Argentina hoy no aplica DST, pero el default es
 * configurable por gym y este módulo no puede asumir que nadie va a poner Santiago
 * o Madrid.
 */
function medianocheLocal(year: number, month: number, day: number, zona: string): Date {
  const comoSiFueraUtc = Date.UTC(year, month - 1, day);

  const aproximado = new Date(comoSiFueraUtc - offsetEnMs(new Date(comoSiFueraUtc), zona));

  return new Date(comoSiFueraUtc - offsetEnMs(aproximado, zona));
}

/**
 * El día calendario del gimnasio que contiene ese instante, como rango semiabierto
 * `[inicio, fin)` — la misma convención que el resto de los rangos del dominio.
 *
 * Es lo que hace que "el segundo escaneo del mismo socio hoy" signifique lo mismo
 * para un molinete de Buenos Aires que para el proceso Node que lo atiende.
 */
export function limitesDelDiaEn(instante: Date, zona: string): DateRange {
  const { year, month, day } = partesEn(instante, zona);

  return {
    start: medianocheLocal(year, month, day, zona),
    // `Date.UTC` normaliza el desborde, así que el 31 de marzo + 1 da el 1 de abril
    // sin que haya que saber cuántos días tiene el mes.
    end: medianocheLocal(year, month, day + 1, zona),
  };
}

/**
 * Los últimos `dias` días calendario del gimnasio, cerrando al final de hoy.
 *
 * Rango semiabierto `[start, end)` como todo el dominio: `end` es la medianoche de
 * mañana, exclusiva, para que el día en curso entre completo. Es la ventana del mapa
 * de calor de asistencia.
 *
 * El instante intermedio se ubica al MEDIODÍA local antes de recortar el día. Restar
 * `dias × 24h` sobre una medianoche cae justo encima del borde, y en una zona con
 * horario de verano ese borde se corre una hora y el rango termina teniendo un día
 * de más. El mediodía nunca está cerca de una transición.
 */
export function ultimosDiasEn(now: Date, dias: number, zona: string): DateRange {
  const finDeHoy = limitesDelDiaEn(now, zona).end;
  const mediodiaDelPrimerDia = new Date(
    finDeHoy.getTime() - dias * MS_POR_DIA + MS_POR_DIA / 2
  );

  return { start: limitesDelDiaEn(mediodiaDelPrimerDia, zona).start, end: finDeHoy };
}

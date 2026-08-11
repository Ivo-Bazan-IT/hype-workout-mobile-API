import { describe, it, expect } from 'vitest';
import {
  ZONA_HORARIA_DEFAULT,
  esZonaHorariaValida,
  limitesDelDiaEn,
} from '../../../src/domain/time/zonaHoraria';

/**
 * Dominio puro: no toca base, no lee el reloj, no depende de la zona del proceso.
 *
 * Todas las aserciones van contra instantes UTC explícitos a propósito. Un test que
 * construya fechas con `new Date(y, m, d)` daría distinto en un contenedor UTC que en
 * una máquina argentina, y esa dependencia del host es exactamente el bug que este
 * módulo vino a cerrar: no se puede verificar con una herramienta que lo padece.
 */
describe('zonaHoraria', () => {
  describe('esZonaHorariaValida', () => {
    it.each([
      'America/Argentina/Buenos_Aires',
      'America/Santiago',
      'Europe/Madrid',
      'UTC',
    ])('acepta %s', (zona) => {
      expect(esZonaHorariaValida(zona)).toBe(true);
    });

    it.each([['Marte/Olympus'], ['Buenos Aires'], [''], ['UTC-3']])(
      'rechaza %s',
      (zona) => {
        expect(esZonaHorariaValida(zona)).toBe(false);
      }
    );

    it('acepta el default del dominio', () => {
      expect(esZonaHorariaValida(ZONA_HORARIA_DEFAULT)).toBe(true);
    });
  });

  describe('limitesDelDiaEn', () => {
    const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

    it('corta el día a la medianoche del gimnasio, no a la de UTC', () => {
      // Mediodía en Buenos Aires.
      const dia = limitesDelDiaEn(new Date('2026-03-10T15:00:00.000Z'), BUENOS_AIRES);

      expect(dia.start.toISOString()).toBe('2026-03-10T03:00:00.000Z');
      expect(dia.end.toISOString()).toBe('2026-03-11T03:00:00.000Z');
    });

    /**
     * El caso que rompía la idempotencia del check-in.
     *
     * Las 21:30 de un lunes en Buenos Aires ya son las 00:30 del martes en UTC. Con el
     * corte en UTC ese ingreso pertenecía al martes, y el socio que volvía a escanear
     * media hora después figuraba con dos visitas en dos días.
     */
    it('un ingreso nocturno pertenece al día del gimnasio, no al de UTC', () => {
      const lunesALas2130 = new Date('2026-03-10T00:30:00.000Z');

      expect(lunesALas2130.getUTCDate()).toBe(10); // en UTC ya es el martes

      const dia = limitesDelDiaEn(lunesALas2130, BUENOS_AIRES);

      // Pero para el gimnasio sigue siendo el lunes 9.
      expect(dia.start.toISOString()).toBe('2026-03-09T03:00:00.000Z');
      expect(dia.end.toISOString()).toBe('2026-03-10T03:00:00.000Z');
    });

    it('incluye el inicio y excluye el fin: rango semiabierto', () => {
      const dia = limitesDelDiaEn(new Date('2026-03-10T15:00:00.000Z'), BUENOS_AIRES);

      // El fin de un día es exactamente el inicio del siguiente, sin solaparse ni
      // dejar un hueco de un milisegundo entre ambos.
      const siguiente = limitesDelDiaEn(dia.end, BUENOS_AIRES);

      expect(siguiente.start.getTime()).toBe(dia.end.getTime());
    });

    it('con el gym en UTC el día coincide con el día UTC', () => {
      const dia = limitesDelDiaEn(new Date('2026-03-10T00:30:00.000Z'), 'UTC');

      expect(dia.start.toISOString()).toBe('2026-03-10T00:00:00.000Z');
      expect(dia.end.toISOString()).toBe('2026-03-11T00:00:00.000Z');
    });

    it('cruza el fin de mes sin que haya que saber cuántos días tiene', () => {
      const dia = limitesDelDiaEn(new Date('2026-03-31T20:00:00.000Z'), BUENOS_AIRES);

      expect(dia.start.toISOString()).toBe('2026-03-31T03:00:00.000Z');
      expect(dia.end.toISOString()).toBe('2026-04-01T03:00:00.000Z');
    });

    /**
     * El día en que arranca el horario de verano dura 23 horas, y es lo que obliga a
     * resolver el offset en dos pasadas.
     *
     * Madrid pasa de CET (UTC+1) a CEST (UTC+2) el 29 de marzo de 2026. Con una sola
     * pasada, el fin del día se calcularía con el offset de la medianoche —una hora—
     * y quedaría corrido. Argentina no aplica DST, pero la zona es configurable por
     * gym y este módulo no puede asumir que nadie va a poner Madrid o Santiago.
     */
    it('respeta el cambio de horario de verano: el día dura 23 horas', () => {
      const dia = limitesDelDiaEn(new Date('2026-03-29T12:00:00.000Z'), 'Europe/Madrid');

      expect(dia.start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
      expect(dia.end.toISOString()).toBe('2026-03-29T22:00:00.000Z');

      const horas = (dia.end.getTime() - dia.start.getTime()) / 3_600_000;
      expect(horas).toBe(23);
    });

    it('respeta el fin del horario de verano: el día dura 25 horas', () => {
      const dia = limitesDelDiaEn(new Date('2026-10-25T12:00:00.000Z'), 'Europe/Madrid');

      const horas = (dia.end.getTime() - dia.start.getTime()) / 3_600_000;
      expect(horas).toBe(25);
    });

    it('no depende de los milisegundos del instante consultado', () => {
      const conMilisegundos = limitesDelDiaEn(
        new Date('2026-03-10T15:00:00.123Z'),
        BUENOS_AIRES
      );
      const sinMilisegundos = limitesDelDiaEn(
        new Date('2026-03-10T15:00:00.000Z'),
        BUENOS_AIRES
      );

      expect(conMilisegundos.start.getTime()).toBe(sinMilisegundos.start.getTime());
    });
  });
});

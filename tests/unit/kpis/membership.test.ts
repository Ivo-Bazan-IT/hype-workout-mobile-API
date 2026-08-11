import { describe, it, expect } from 'vitest';
import {
  DIAS_DE_GRACIA_POR_DEFECTO,
  MembershipWindow,
  churnDates,
  churnedDuring,
  firstChurnDate,
  isActiveAt,
  membershipSegments,
  membershipStatusAt,
  reactivationDates,
  windowAt,
} from '../../../src/domain/kpis/membership';

const f = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Alta el 1/1 con vencimiento el 31/1. */
const ALTA: MembershipWindow = { inicio: f('2026-01-01'), vencimiento: f('2026-01-31') };

describe('membershipSegments', () => {
  it('la gracia por defecto es de 5 días', () => {
    expect(DIAS_DE_GRACIA_POR_DEFECTO).toBe(5);
  });

  it('encadena la renovación anticipada en un solo tramo', () => {
    // El caso normal: se renueva el 28 sin haber vencido todavía.
    const ventanas = [ALTA, { inicio: f('2026-01-28'), vencimiento: f('2026-02-28') }];

    const segmentos = membershipSegments(ventanas);

    expect(segmentos).toHaveLength(1);
    expect(segmentos[0]).toEqual({ inicio: f('2026-01-01'), fin: f('2026-02-28') });
  });

  it('encadena la renovación atrasada que cae DENTRO de la gracia', () => {
    // Venció el 31/1 y pagó el 5/2: exactamente el último día de gracia.
    const ventanas = [ALTA, { inicio: f('2026-02-05'), vencimiento: f('2026-03-07') }];

    expect(membershipSegments(ventanas)).toHaveLength(1);
  });

  it('corta en dos tramos cuando la renovación llega pasada la gracia', () => {
    // Un día más tarde que el caso anterior y el negocio ya es otro: hubo baja.
    const ventanas = [ALTA, { inicio: f('2026-02-06'), vencimiento: f('2026-03-08') }];

    const segmentos = membershipSegments(ventanas);

    expect(segmentos).toHaveLength(2);
    expect(segmentos[0].fin).toEqual(f('2026-01-31'));
    expect(segmentos[1].inicio).toEqual(f('2026-02-06'));
  });

  it('ordena las ventanas y no muta la entrada', () => {
    const ventanas: MembershipWindow[] = [
      { inicio: f('2026-01-28'), vencimiento: f('2026-02-28') },
      ALTA,
    ];
    const copia = [...ventanas];

    const segmentos = membershipSegments(ventanas);

    expect(segmentos[0].inicio).toEqual(f('2026-01-01'));
    expect(ventanas).toEqual(copia);
  });

  it('conserva el vencimiento más tardío si una renovación deja uno anterior', () => {
    const ventanas = [ALTA, { inicio: f('2026-01-10'), vencimiento: f('2026-01-20') }];

    expect(membershipSegments(ventanas)[0].fin).toEqual(f('2026-01-31'));
  });

  it('devuelve vacío sin ventanas', () => {
    expect(membershipSegments([])).toEqual([]);
  });
});

describe('churnDates y reactivationDates', () => {
  it('la baja queda firme al vencimiento más la gracia', () => {
    expect(churnDates([ALTA])).toEqual([f('2026-02-05')]);
  });

  it('la vuelta después de una baja firme es una reactivación', () => {
    const ventanas = [ALTA, { inicio: f('2026-06-01'), vencimiento: f('2026-07-01') }];

    expect(reactivationDates(ventanas)).toEqual([f('2026-06-01')]);
  });

  it('el alta original no cuenta como reactivación', () => {
    expect(reactivationDates([ALTA])).toEqual([]);
  });
});

describe('firstChurnDate', () => {
  it('devuelve la PRIMERA baja, no la última', () => {
    const ventanas = [
      ALTA,
      { inicio: f('2026-06-01'), vencimiento: f('2026-07-01') },
    ];

    expect(firstChurnDate(ventanas, f('2026-12-01'))).toEqual(f('2026-02-05'));
  });

  it('devuelve null si la baja proyectada todavía no ocurrió', () => {
    // Socio vigente: su tramo tiene fecha de baja, pero es futura.
    expect(firstChurnDate([ALTA], f('2026-01-15'))).toBeNull();
  });
});

describe('membershipStatusAt', () => {
  it('está vigente dentro de la ventana', () => {
    expect(membershipStatusAt({ windows: [ALTA], at: f('2026-01-15') })).toBe('vigente');
  });

  it('está en gracia entre el vencimiento y el fin de la gracia', () => {
    expect(membershipStatusAt({ windows: [ALTA], at: f('2026-02-03') })).toBe('en_gracia');
  });

  it('está de baja pasada la gracia', () => {
    expect(membershipStatusAt({ windows: [ALTA], at: f('2026-02-07') })).toBe('de_baja');
  });

  it('está de baja antes de su propia alta', () => {
    expect(membershipStatusAt({ windows: [ALTA], at: f('2025-12-01') })).toBe('de_baja');
  });

  it('vuelve a estar vigente tras una reactivación', () => {
    const ventanas = [ALTA, { inicio: f('2026-06-01'), vencimiento: f('2026-07-01') }];

    expect(membershipStatusAt({ windows: ventanas, at: f('2026-03-01') })).toBe('de_baja');
    expect(membershipStatusAt({ windows: ventanas, at: f('2026-06-15') })).toBe('vigente');
  });

  it('respeta una gracia distinta a la del default', () => {
    expect(
      membershipStatusAt({ windows: [ALTA], at: f('2026-02-07'), diasDeGracia: 10 })
    ).toBe('en_gracia');
  });
});

describe('isActiveAt', () => {
  it('cuenta como socio al que está en gracia: la baja todavía no es firme', () => {
    expect(isActiveAt([ALTA], f('2026-02-03'))).toBe(true);
  });

  it('no cuenta al que ya está de baja', () => {
    expect(isActiveAt([ALTA], f('2026-02-07'))).toBe(false);
  });
});

describe('windowAt', () => {
  const ventanas = [
    { inicio: f('2026-01-01'), vencimiento: f('2026-01-31'), monto: 700 },
    { inicio: f('2026-02-01'), vencimiento: f('2026-03-03'), monto: 900 },
  ];

  it('devuelve la última ventana que arrancó antes de la fecha', () => {
    expect(windowAt(ventanas, f('2026-02-15'))?.monto).toBe(900);
    expect(windowAt(ventanas, f('2026-01-15'))?.monto).toBe(700);
  });

  it('sigue devolviendo la última ventana cuando el socio está en gracia', () => {
    // El 5 de marzo ya no hay ventana que contenga la fecha, pero la cuota vigente
    // —la que el MRR necesita— sigue siendo la del último pago.
    expect(windowAt(ventanas, f('2026-03-05'))?.monto).toBe(900);
  });

  it('devuelve null si todavía no había empezado ninguna', () => {
    expect(windowAt(ventanas, f('2025-12-31'))).toBeNull();
  });

  it('devuelve null sin ventanas', () => {
    expect(windowAt([], f('2026-02-15'))).toBeNull();
  });
});

describe('churnedDuring', () => {
  const rangoFebrero = { start: f('2026-02-01'), end: f('2026-03-01') };

  it('detecta la baja que cae dentro del período', () => {
    expect(churnedDuring([ALTA], rangoFebrero)).toBe(true);
  });

  it('no cuenta la baja de un socio que renovó dentro de la gracia', () => {
    const ventanas = [ALTA, { inicio: f('2026-02-05'), vencimiento: f('2026-03-07') }];

    expect(churnedDuring(ventanas, rangoFebrero)).toBe(false);
  });

  it('la reactivación posterior no borra la baja del período ya cerrado', () => {
    // Se fue en febrero y volvió en junio: febrero sigue teniendo su baja.
    const ventanas = [ALTA, { inicio: f('2026-06-01'), vencimiento: f('2026-07-01') }];

    expect(churnedDuring(ventanas, rangoFebrero)).toBe(true);
  });

  it('el rango es semiabierto: una baja el día del corte pertenece al período siguiente', () => {
    const ventanas: MembershipWindow[] = [
      { inicio: f('2026-01-05'), vencimiento: f('2026-02-24') },
    ];

    expect(churnDates(ventanas)).toEqual([f('2026-03-01')]);
    expect(churnedDuring(ventanas, rangoFebrero)).toBe(false);
  });
});

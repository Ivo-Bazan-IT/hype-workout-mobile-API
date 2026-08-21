/**
 * Cuánto vale una rutina generada.
 *
 * La planificación es **mensual**: una rutina generada el día X vence el día X+30,
 * y a partir de ahí el socio necesita una nueva. Es una regla del producto, no un
 * detalle del generador, así que vive en el dominio y no dentro del caso de uso.
 *
 * **No se confunde con el vencimiento de la MEMBRESÍA**, que es otra fecha y otra
 * cosa: la membresía dice hasta cuándo el socio pagó, la rutina dice hasta cuándo
 * sirve el plan de entrenamiento. Un socio que renueva su cuota a mitad de mes
 * sigue con la misma rutina hasta que esta se venza, y uno que dejó de pagar
 * conserva una rutina vigente que ya nadie va a usar. Antes se guardaba la fecha
 * de la membresía en el campo de la rutina, así que ninguna de las dos preguntas
 * se podía responder bien: el PDF le prometía al socio una vigencia que no era la
 * del plan, y el listado de rutinas por vencer mostraba vencimientos de cuotas.
 */

/** Duración de una planificación. Mensual, contada en días para no arrastrar el problema de los meses de 28/31. */
export const VIGENCIA_RUTINA_DIAS = 30;

/**
 * Vencimiento de una rutina generada en `fechaGeneracion`.
 *
 * Devuelve una fecha nueva: mutar la que entra dejaría al llamador con la fecha de
 * generación corrida treinta días, que es el tipo de bug que después aparece como
 * "la rutina figura generada en el futuro".
 *
 * Conserva la hora del día, igual que el vencimiento de la membresía en
 * `CreateClientUseCase`. Las consultas de "vence tal día" ya acotan por límites del
 * día, así que la hora no cambia a qué día pertenece.
 */
export const calcularVencimientoRutina = (fechaGeneracion: Date): Date => {
  const vencimiento = new Date(fechaGeneracion);
  vencimiento.setDate(vencimiento.getDate() + VIGENCIA_RUTINA_DIAS);
  return vencimiento;
};

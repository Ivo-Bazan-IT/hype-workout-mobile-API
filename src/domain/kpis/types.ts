/**
 * Unidades y tipos compartidos por los KPIs del dashboard.
 *
 * Todo lo que vive en `domain/kpis/` es dominio puro: no hace I/O, no lee el reloj
 * del sistema y no conoce Mongoose ni Express. Recibe datos ya materializados y
 * devuelve un valor calculado. Eso lo hace determinístico y testeable sin base de
 * datos, que es justamente lo que un dashboard con veinte métricas necesita para
 * no volverse imposible de verificar.
 *
 * Tres reglas gobiernan todas las firmas de este paquete:
 *
 *  1. **El tiempo se inyecta.** Cuando un cálculo depende de "ahora", `now` entra
 *     como parámetro. Nunca se llama a `new Date()` acá adentro: dos corridas con
 *     la misma entrada tienen que dar el mismo resultado.
 *  2. **Dinero en centavos enteros**, nunca float. OJO con el borde: la base guarda
 *     los montos en pesos (`Invoice.monto`, `historialRenovaciones[].monto`), así
 *     que la conversión a centavos la hace el adaptador al leer. El dominio asume
 *     que lo que le llega ya está en centavos.
 *  3. **Denominador cero devuelve `null`.** "Todavía no hay socios" o "no hubo
 *     leads" es un estado de negocio válido, no un error ni un 0. El `| null` del
 *     tipo de retorno obliga a quien consume a decidir cómo se muestra, en vez de
 *     dejar que un 0% falso se cuele al dashboard.
 */

/** Dinero en la mínima unidad monetaria (centavos), como entero. Nunca float. */
export type Cents = number;

/**
 * Tasa expresada como fracción decimal en [0, 1]. 0.05 = 5%.
 * El dominio no formatea porcentajes: eso es trabajo de la capa de presentación.
 */
export type Rate = number;

/** Rango temporal semiabierto [start, end). */
export interface DateRange {
  readonly start: Date;
  readonly end: Date;
}

export const MS_POR_DIA = 24 * 60 * 60 * 1000;

export const MS_POR_MINUTO = 60 * 1000;

export const DIAS_POR_SEMANA = 7;

/**
 * Longitud de mes usada para normalizar a base mensual (cuotas, MRR).
 * Es una convención de negocio, no un cálculo calendario: una cuota de 30 días y
 * una de 31 valen lo mismo como "cuota mensual", y hacerlo exacto por mes haría
 * que el MRR oscile solo porque febrero es más corto.
 */
export const DIAS_POR_MES = 30;

/** Días transcurridos entre dos fechas. Negativo si `hasta` es anterior a `desde`. */
export const diasEntre = (desde: Date, hasta: Date): number =>
  (hasta.getTime() - desde.getTime()) / MS_POR_DIA;

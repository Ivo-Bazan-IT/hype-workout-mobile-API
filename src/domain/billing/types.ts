/**
 * Condición fiscal del gimnasio EMISOR.
 *
 * Solo existen las dos con fines de lucro. `EXENTO` se quitó a propósito: el
 * producto se vende a entidades que facturan, y dejar la opción abierta obligaba
 * a mantener un tercer camino de cálculo que nadie iba a usar — y que además
 * estaba mal, porque caía en la rama de Responsable Inscripto y discriminaba IVA.
 */
export enum GymTaxCondition {
  MONOTRIBUTO = 'MONOTRIBUTO',
  RESPONSABLE_INSCRIPTO = 'RESPONSABLE_INSCRIPTO'
}

/** Para el enum de Mongoose y el de Zod, que necesitan la lista como array. */
export const CONDICIONES_FISCALES = Object.values(GymTaxCondition);

export interface ComprobanteFiscal {
  /** Código de tipo de comprobante de AFIP (el que viaja en el request). */
  codigo: number;
  /** Nombre legible, el que ve el dueño del gym en el historial. */
  nombre: string;
}

/**
 * Al socio de un gimnasio se le factura SIEMPRE como consumidor final, así que la
 * condición fiscal del emisor alcanza por sí sola para determinar el comprobante:
 * un monotributista emite C y un responsable inscripto emite B. La Factura A no
 * aparece nunca en este negocio, porque exigiría que el socio fuera responsable
 * inscripto comprando a nombre de su CUIT.
 *
 * Esta tabla es la ÚNICA fuente de verdad del tipo de comprobante. Antes el código
 * numérico se decidía en el adaptador y el nombre se volvía a decidir, por separado,
 * en el caso de uso: dos lugares para la misma regla es una divergencia esperando
 * pasar.
 */
export const COMPROBANTE_POR_CONDICION: Record<GymTaxCondition, ComprobanteFiscal> = {
  [GymTaxCondition.MONOTRIBUTO]: { codigo: 11, nombre: 'Factura C' },
  [GymTaxCondition.RESPONSABLE_INSCRIPTO]: { codigo: 6, nombre: 'Factura B' }
};

/** Alícuota general. Solo el responsable inscripto discrimina IVA. */
export const ALICUOTA_IVA = 0.21;

/**
 * Config de la cuenta ÚNICA de plataforma (modo `cuenta_unica` de
 * `AFIP_BILLING_MODE`, desconectado por ahora). NO tocar: el día que se
 * confirme con AFIP SDK que un plan soporta varios CUIT bajo una cuenta, este
 * modo se retoma tal cual está. Ver `OwnAccountApiConfig` para el modo activo.
 */
export interface TenantApiConfig {
  tenantId: string;
  /** CUIT del gimnasio emisor. Es quien factura, no el socio. */
  cuit: number;
  puntoVenta: number;
  taxCondition: GymTaxCondition;
  afipSdkApiKey: string; // Token de acceso específico del tenant
}

/**
 * Config de la cuenta PROPIA de AFIP SDK de un gym (modo `cuenta_propia`,
 * activo por default). A diferencia de `TenantApiConfig`, acá el gimnasio no
 * solo aporta su identidad fiscal: factura contra SU cuenta de AFIP SDK, con
 * su propio certificado y clave privada.
 */
export interface OwnAccountApiConfig {
  tenantId: string;
  cuit: number;
  puntoVenta: number;
  taxCondition: GymTaxCondition;
  /** Access token de la cuenta de AFIP SDK del gym (app.afipsdk.com). */
  accessToken: string;
  /** Contenido del archivo .crt del gym, tal cual lo entrega AFIP. */
  cert: string;
  /** Contenido del archivo .key del gym: la clave privada del certificado. */
  key: string;
}

/**
 * Condición fiscal del CLIENTE (el socio), no del gimnasio. Solo existen estos
 * dos valores porque el negocio no distingue un monotributista real de un
 * consumidor final en el socio: a los dos se los factura igual (Factura B). El
 * único caso especial es el socio Responsable Inscripto, que factura a su CUIT.
 */
export enum ClientTaxCondition {
  RESPONSABLE_INSCRIPTO = 'RESPONSABLE_INSCRIPTO',
  CONSUMIDOR_FINAL = 'CONSUMIDOR_FINAL'
}

export const CONDICIONES_FISCALES_CLIENTE = Object.values(ClientTaxCondition);

export interface ComprobanteResuelto extends ComprobanteFiscal {
  /** Tipo de documento AFIP del receptor: 80 = CUIT, 96 = DNI. */
  docType: number;
  /** Código de tabla de AFIP para la condición IVA del receptor (RG 5616). */
  condicionIVAReceptorId: number;
}

const FACTURA_A: ComprobanteResuelto = { codigo: 1, nombre: 'Factura A', docType: 80, condicionIVAReceptorId: 1 };
const FACTURA_B: ComprobanteResuelto = { codigo: 6, nombre: 'Factura B', docType: 96, condicionIVAReceptorId: 5 };
const FACTURA_C: ComprobanteResuelto = { codigo: 11, nombre: 'Factura C', docType: 96, condicionIVAReceptorId: 5 };

/**
 * Único lugar donde se decide qué comprobante corresponde, para el modo
 * `cuenta_propia`. Depende de DOS condiciones fiscales, no de una sola como en
 * `COMPROBANTE_POR_CONDICION` (que es del modo legacy, donde Factura A no
 * existía):
 *
 *  - Monotributo (gym) => Factura C siempre, sin mirar al cliente: un
 *    monotributista no puede emitir A ni discriminar IVA.
 *  - Responsable Inscripto (gym) + cliente Responsable Inscripto => Factura A,
 *    el único caso de este negocio donde el socio factura a su propio CUIT.
 *  - Responsable Inscripto (gym) + cliente Consumidor Final/Monotributo =>
 *    Factura B.
 */
export const resolverComprobante = (
  gymCondition: GymTaxCondition,
  clientCondition: ClientTaxCondition
): ComprobanteResuelto => {
  if (gymCondition === GymTaxCondition.MONOTRIBUTO) return FACTURA_C;
  return clientCondition === ClientTaxCondition.RESPONSABLE_INSCRIPTO ? FACTURA_A : FACTURA_B;
};

export interface GymInvoicePayload {
  /** Importe total en pesos, IVA incluido: es lo que el socio pagó. */
  amount: number;
  /** DNI del socio. Ausente solo cuando es Responsable Inscripto (ahí se usa `clientCuit`). */
  clientDocument?: number;
  /** Ej: "Cuota Mensual - Marzo" */
  description: string;
  /** Condición fiscal del socio: decide entre Factura A y B (ver `resolverComprobante`). */
  clientTaxCondition: ClientTaxCondition;
  /** CUIT del socio. Solo se usa (y es obligatorio) cuando es Responsable Inscripto. */
  clientCuit?: number;
}

/**
 * Lo que el proveedor de facturación le devuelve al dominio.
 *
 * Es deliberadamente más ancho que "el CAE": el comprobante recién queda
 * identificado con punto de venta + tipo + número, y sin el vencimiento del CAE no
 * se puede auditar ni reimprimir. La forma cruda de la respuesta del vendor vive en
 * `infrastructure/external/billing`, no acá.
 */
export interface ResultadoEmision {
  cae: string;
  vencimientoCae: Date;
  numeroComprobante: number;
  puntoVenta: number;
  codigoTipoComprobante: number;
  /** Nombre legible que sale de `COMPROBANTE_POR_CONDICION`. */
  tipoComprobante: string;
  neto: number;
  iva: number;
  importeTotal: number;
}

import { Types } from 'mongoose';

/**
 * Ciclo de vida de un comprobante:
 *
 *   pendiente ──emite OK──> emitida
 *       │  ▲
 *       │  └── reintento (automático si el fallo fue transitorio, o manual)
 *       └──fallo definitivo──> error
 *
 * `pendiente` es el estado en el que nace: la renovación del socio la registra y
 * responde sin esperar a AFIP. `anulada` queda reservada para la nota de crédito,
 * que todavía no está implementada.
 */
export type InvoiceStatus = 'emitida' | 'anulada' | 'error' | 'pendiente';

export interface Invoice {
  id: string;
  gymId: string;
  clientId: string;

  // --- Identificación fiscal del comprobante ---------------------------------
  // Un comprobante NO queda identificado por el CAE sino por la terna
  // (punto de venta, tipo, número). Sin ella no se puede reimprimir ni cruzar
  // con lo que AFIP tiene registrado.
  /** Nombre legible: "Factura B" | "Factura C". */
  tipoComprobante: string;
  /** Código de tipo de comprobante de AFIP (6 | 11). Vacío mientras está pendiente. */
  codigoTipoComprobante?: number;
  puntoVenta?: number;
  numeroComprobante?: number;
  cae: string;
  vencimientoCae?: Date;

  // --- Importes -------------------------------------------------------------
  /**
   * Importe total en PESOS, IVA incluido. Es el campo que suman los reportes de
   * ingresos y el KPI del dashboard, así que no cambia de significado.
   */
  monto: number;
  /** Neto gravado. Solo lo informa el responsable inscripto; en monotributo es igual al total. */
  neto?: number;
  /** IVA discriminado. Cero en monotributo. */
  iva?: number;

  /** Concepto facturado, ej: "Cuota Mensual - marzo". */
  descripcion?: string;
  /** Instante en que AFIP otorgó el CAE. Mientras está pendiente, el del alta. */
  fechaEmision: Date;
  estado: InvoiceStatus;
  errorLog?: string;

  // --- Bookkeeping de reintentos --------------------------------------------
  /** Cuántas veces se intentó emitir. Se incrementa al tomar la factura, no al fallar. */
  intentos: number;
  /**
   * Desde cuándo la factura se puede volver a tomar. El worker la usa para dos
   * cosas a la vez: el backoff entre reintentos y el lease que evita que dos
   * procesos emitan el mismo comprobante por duplicado.
   */
  proximoIntento?: Date;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * El constructor recibe un objeto y no una lista posicional: con casi veinte campos
 * —y la mitad opcionales— la forma posicional que tenía antes convertía cualquier
 * agregado en una oportunidad de cruzar `neto` con `iva` sin que el compilador
 * dijera nada.
 */
export class InvoiceEntity implements Invoice {
  public id: string;
  public gymId: string;
  public clientId: string;
  public tipoComprobante: string;
  public codigoTipoComprobante?: number;
  public puntoVenta?: number;
  public numeroComprobante?: number;
  public cae: string;
  public vencimientoCae?: Date;
  public monto: number;
  public neto?: number;
  public iva?: number;
  public descripcion?: string;
  public fechaEmision: Date;
  public estado: InvoiceStatus;
  public errorLog?: string;
  public intentos: number;
  public proximoIntento?: Date;
  public createdAt: Date;
  public updatedAt: Date;

  constructor(props: Invoice) {
    this.id = props.id;
    this.gymId = props.gymId;
    this.clientId = props.clientId;
    this.tipoComprobante = props.tipoComprobante;
    this.codigoTipoComprobante = props.codigoTipoComprobante;
    this.puntoVenta = props.puntoVenta;
    this.numeroComprobante = props.numeroComprobante;
    this.cae = props.cae;
    this.vencimientoCae = props.vencimientoCae;
    this.monto = props.monto;
    this.neto = props.neto;
    this.iva = props.iva;
    this.descripcion = props.descripcion;
    this.fechaEmision = props.fechaEmision;
    this.estado = props.estado;
    this.errorLog = props.errorLog;
    this.intentos = props.intentos;
    this.proximoIntento = props.proximoIntento;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}

export class InvoiceMapper {
  static toDomain(doc: any): Invoice {
    return new InvoiceEntity({
      id: doc._id.toString(),
      gymId: doc.gymId.toString(),
      clientId: doc.clientId.toString(),
      tipoComprobante: doc.tipoComprobante,
      codigoTipoComprobante: doc.codigoTipoComprobante,
      puntoVenta: doc.puntoVenta,
      numeroComprobante: doc.numeroComprobante,
      cae: doc.cae,
      vencimientoCae: doc.vencimientoCae,
      monto: doc.monto,
      neto: doc.neto,
      iva: doc.iva,
      descripcion: doc.descripcion,
      fechaEmision: doc.fechaEmision,
      estado: doc.estado,
      errorLog: doc.errorLog,
      // Los documentos escritos antes de que existiera el reintento no traen el
      // contador: valen como "todavía no se intentó".
      intentos: doc.intentos ?? 0,
      proximoIntento: doc.proximoIntento,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    });
  }

  static toPersistence(entity: InvoiceEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      clientId: new Types.ObjectId(entity.clientId),
      tipoComprobante: entity.tipoComprobante,
      codigoTipoComprobante: entity.codigoTipoComprobante,
      puntoVenta: entity.puntoVenta,
      numeroComprobante: entity.numeroComprobante,
      cae: entity.cae,
      vencimientoCae: entity.vencimientoCae,
      monto: entity.monto,
      neto: entity.neto,
      iva: entity.iva,
      descripcion: entity.descripcion,
      fechaEmision: entity.fechaEmision,
      estado: entity.estado,
      errorLog: entity.errorLog,
      intentos: entity.intentos,
      proximoIntento: entity.proximoIntento,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt
    };
  }
}

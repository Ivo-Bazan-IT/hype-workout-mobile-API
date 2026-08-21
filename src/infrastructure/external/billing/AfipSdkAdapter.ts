import axios, { AxiosInstance } from 'axios';
import {
  TenantApiConfig,
  GymInvoicePayload,
  ResultadoEmision,
  GymTaxCondition,
  COMPROBANTE_POR_CONDICION,
  ALICUOTA_IVA
} from '../../../domain/billing/types';
import { InvoiceEmissionError } from '../../../domain/billing/errors';
import { IInvoiceProvider } from '../../../domain/services/IInvoiceProvider';

/**
 * Respuesta cruda de AFIP SDK. Vive acá y no en el dominio: es la forma del vendor,
 * y el dominio solo conoce `ResultadoEmision`. Si mañana se cambia de proveedor,
 * el que se reescribe es este archivo y nada más.
 */
export interface AfipSdkInvoiceResponse {
  cae: string;
  vencimiento_cae: string;
  numero_comprobante: number;
  punto_venta: number;
  tipo_comprobante: number;
}

/** Entornos de AFIP SDK: `dev` es el homologación de ARCA, `prod` emite de verdad. */
export type AfipSdkEnvironment = 'dev' | 'prod';

export class AfipSdkAdapter implements IInvoiceProvider {
  private http: AxiosInstance;
  private config: TenantApiConfig;
  private environment: AfipSdkEnvironment;

  // Constantes del protocolo de AFIP
  /** 96 = DNI. Al socio de un gimnasio se le factura siempre como consumidor final. */
  private readonly TIPO_DOC_DNI = 96;
  private readonly CONCEPTO_SERVICIOS = 2;

  /**
   * `baseURL` y `environment` llegan siempre inyectados, sin default: este
   * adaptador arma y postea comprobantes, no decide contra qué ARCA se emite.
   * Esa decisión es configuración del despliegue y la resuelve
   * `AfipSdkAdapterFactory` leyendo el entorno una sola vez.
   */
  constructor(
    config: TenantApiConfig,
    baseURL: string,
    environment: AfipSdkEnvironment
  ) {
    this.config = config;
    this.environment = environment;

    // Inicialización del cliente HTTP encapsulado
    this.http = axios.create({
      baseURL,
      timeout: 15000,
      headers: {
        'Authorization': `Bearer ${this.config.afipSdkApiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Emite la factura electrónica utilizando la API de AFIP SDK.
   *
   * `payload.description` no viaja en el request: el comprobante electrónico de
   * servicios no lleva texto libre. Se persiste de este lado para que el dueño del
   * gym sepa qué cuota corresponde a cada CAE.
   */
  public async emitInvoice(payload: GymInvoicePayload): Promise<ResultadoEmision> {
    const comprobante = COMPROBANTE_POR_CONDICION[this.config.taxCondition];
    const { neto, iva, importeTotal } = this.calcularImportes(payload.amount);

    const requestBody = {
      // Contra qué ARCA se emite. `dev` es homologación: los comprobantes son
      // válidos como prueba pero no existen fiscalmente. Va en el cuerpo porque
      // este adaptador postea la factura directo con el Bearer token, sin una
      // llamada de autenticación previa donde ponerlo.
      environment: this.environment,
      // El CUIT del emisor: sin él AFIP no sabe a nombre de quién se emite.
      cuit: this.config.cuit,
      punto_venta: this.config.puntoVenta,
      tipo_comprobante: comprobante.codigo,
      concepto: this.CONCEPTO_SERVICIOS,
      tipo_documento: this.TIPO_DOC_DNI,
      numero_documento: payload.clientDocument,
      importe_total: importeTotal,
      importe_neto: neto,
      importe_iva: iva,
      importe_exento: 0,
      // Fechas de servicio requeridas para concepto=2 (Servicios)
      fecha_servicio_desde: this.getTodayString(),
      fecha_servicio_hasta: this.getTodayString(),
      fecha_vencimiento_pago: this.getTodayString()
    };

    let respuesta: AfipSdkInvoiceResponse;
    try {
      const response = await this.http.post<AfipSdkInvoiceResponse>('/v1/facturas', requestBody);
      respuesta = response.data;
    } catch (error: any) {
      throw this.traducirError(error);
    }

    return {
      cae: respuesta.cae,
      vencimientoCae: this.parseFechaAfip(respuesta.vencimiento_cae),
      numeroComprobante: respuesta.numero_comprobante,
      // Lo que devuelve AFIP manda sobre lo que se pidió: si el punto de venta o el
      // tipo de comprobante vinieran distintos, el comprobante real es el suyo.
      puntoVenta: respuesta.punto_venta ?? this.config.puntoVenta,
      codigoTipoComprobante: respuesta.tipo_comprobante ?? comprobante.codigo,
      tipoComprobante: comprobante.nombre,
      neto,
      iva,
      importeTotal
    };
  }

  /**
   * Desglose de importes. El monotributista no discrimina IVA, así que su neto es
   * el total; el responsable inscripto factura a consumidor final con el IVA ya
   * incluido en el precio y lo desagrega para informarlo.
   */
  private calcularImportes(amount: number) {
    if (this.config.taxCondition === GymTaxCondition.MONOTRIBUTO) {
      return { neto: amount, iva: 0, importeTotal: amount };
    }

    const neto = Number((amount / (1 + ALICUOTA_IVA)).toFixed(2));
    // El IVA sale por resta y no multiplicando el neto: así neto + iva da exacto el
    // total cobrado, y AFIP rechaza el comprobante si esa suma no cierra al centavo.
    const iva = Number((amount - neto).toFixed(2));

    return { neto, iva, importeTotal: amount };
  }

  /**
   * Traduce el fallo del vendor a un error del dominio ya clasificado, para que la
   * política de reintentos no tenga que leer códigos HTTP ni mensajes de axios.
   */
  private traducirError(error: any): InvoiceEmissionError {
    if (error.response) {
      const { status, data } = error.response;
      if (status >= 400 && status < 500) {
        // Errores de contenido del comprobante (ej. DNI incorrecto, importe discordante)
        return new InvoiceEmissionError(
          `AFIP_API_VALIDATION_ERROR: ${JSON.stringify(data)}`,
          'validacion'
        );
      }
      if (status >= 500) {
        // Caídas del servicio de AFIP
        return new InvoiceEmissionError(
          `AFIP_API_SERVER_ERROR: ${JSON.stringify(data)}`,
          'servicio'
        );
      }
    }
    return new InvoiceEmissionError(
      'NETWORK_ERROR: Timeout o desconexión contactando a AFIP SDK.',
      'red'
    );
  }

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0].replace(/-/g, ''); // Formato AFIP YYYYMMDD
  }

  /**
   * AFIP maneja las fechas como `YYYYMMDD`. Se arma la fecha por componentes y no
   * con `new Date(string)` porque este último interpreta `"20260311"` como un año
   * absurdo en vez de fallar, y el vencimiento del CAE quedaría irreconocible.
   */
  private parseFechaAfip(fecha: string): Date {
    const compacta = String(fecha ?? '').replace(/-/g, '');

    if (!/^\d{8}$/.test(compacta)) {
      // Un vencimiento ilegible no invalida el CAE, que es lo que importa: se deja
      // la fecha del día para no perder el comprobante entero por el formato.
      return new Date();
    }

    return new Date(
      Number(compacta.slice(0, 4)),
      Number(compacta.slice(4, 6)) - 1,
      Number(compacta.slice(6, 8))
    );
  }
}

import axios, { AxiosInstance } from 'axios';
import { TenantApiConfig, GymInvoicePayload, AfipSdkInvoiceResponse, GymTaxCondition } from '../../../domain/billing/types';
import { IInvoiceProvider } from '../../../domain/services/IInvoiceProvider';

export class AfipSdkAdapter implements IInvoiceProvider {
  private http: AxiosInstance;
  private config: TenantApiConfig;

  // Constantes de AFIP
  private readonly TIPO_DOC_DNI = 96;
  private readonly TIPO_DOC_CUIT = 80;
  private readonly CONCEPTO_SERVICIOS = 2;

  constructor(config: TenantApiConfig) {
    this.config = config;

    // Inicialización del cliente HTTP encapsulado
    this.http = axios.create({
      baseURL: 'https://api.afipsdk.com', // Configurable via env
      timeout: 15000,
      headers: {
        'Authorization': `Bearer ${this.config.afipSdkApiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Emite la factura electrónica utilizando la API de AFIP SDK.
   */
  public async emitInvoice(payload: GymInvoicePayload): Promise<AfipSdkInvoiceResponse> {
    const { tipoComprobante, neto, iva, importeTotal } = this.calcularImportesYTipo(payload);

    const requestBody = {
      punto_venta: this.config.puntoVenta,
      tipo_comprobante: tipoComprobante,
      concepto: this.CONCEPTO_SERVICIOS,
      tipo_documento: payload.isConsumidorFinal ? this.TIPO_DOC_DNI : this.TIPO_DOC_CUIT,
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

    try {
      const response = await this.http.post<AfipSdkInvoiceResponse>('/v1/facturas', requestBody);
      return response.data;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  /**
   * Lógica de negocio para determinar alícuotas y comprobantes.
   */
  private calcularImportesYTipo(payload: GymInvoicePayload) {
    if (this.config.taxCondition === GymTaxCondition.MONOTRIBUTO) {
      return {
        tipoComprobante: 11, // Factura C
        neto: payload.amount,
        iva: 0,
        importeTotal: payload.amount
      };
    }

    // Caso Responsable Inscripto
    const tipoComprobante = payload.isConsumidorFinal ? 6 : 1; // 6: Factura B, 1: Factura A
    const neto = Number((payload.amount / 1.21).toFixed(2));
    const iva = Number((payload.amount - neto).toFixed(2));

    return { tipoComprobante, neto, iva, importeTotal: payload.amount };
  }

  private handleApiError(error: any): never {
    if (error.response) {
      const { status, data } = error.response;
      if (status >= 400 && status < 500) {
        // Errores de validación de la API (ej. DNI incorrecto, importe discordante)
        throw new Error(`AFIP_API_VALIDATION_ERROR: ${JSON.stringify(data)}`);
      }
      if (status >= 500) {
        // Caídas del servicio de AFIP
        throw new Error(`AFIP_API_SERVER_ERROR: ${JSON.stringify(data)}`);
      }
    }
    throw new Error(`NETWORK_ERROR: Timeout o desconexión contactando a AFIP SDK.`);
  }

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0].replace(/-/g, ''); // Formato AFIP YYYYMMDD
  }
}
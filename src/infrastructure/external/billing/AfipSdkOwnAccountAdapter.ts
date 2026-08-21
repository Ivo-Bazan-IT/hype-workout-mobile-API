import Afip from '@afipsdk/afip.js';
import {
  OwnAccountApiConfig,
  GymInvoicePayload,
  ResultadoEmision,
  GymTaxCondition,
  ClientTaxCondition,
  resolverComprobante,
  ALICUOTA_IVA
} from '../../../domain/billing/types';
import { InvoiceEmissionError } from '../../../domain/billing/errors';
import { IInvoiceProvider } from '../../../domain/services/IInvoiceProvider';

/** Entornos de AFIP SDK: `dev` es homologación de ARCA, `prod` emite de verdad. */
export type AfipSdkEnvironment = 'dev' | 'prod';

/**
 * Adaptador de la cuenta PROPIA de cada gym (modo `cuenta_propia`).
 *
 * A diferencia del adaptador legacy (`AfipSdkAdapter`, modo `cuenta_unica`,
 * desconectado), esto NO le pega a un REST endpoint propio con Bearer token:
 * usa el paquete oficial `@afipsdk/afip.js`, que resuelve solo la
 * autenticación WSAA (`Auth.Token`/`Sign`) contra el certificado y la clave
 * del gym, y expone `ElectronicBilling.createNextVoucher`, que además resuelve
 * la numeración correlativa consultando a AFIP en vivo (no se lleva un
 * contador local).
 *
 * Verificado contra el código fuente publicado de `@afipsdk/afip.js@1.2.3`
 * (`ElectronicBilling.js`, `Afip.js`): la doc pública no alcanza a explicar
 * cómo se arma `Auth` ni cómo se clasifican los errores.
 */
export class AfipSdkOwnAccountAdapter implements IInvoiceProvider {
  private readonly CONCEPTO_SERVICIOS = 2;
  private readonly afip: Afip;

  constructor(
    private readonly config: OwnAccountApiConfig,
    environment: AfipSdkEnvironment
  ) {
    this.afip = new Afip({
      CUIT: config.cuit,
      cert: config.cert,
      key: config.key,
      access_token: config.accessToken,
      production: environment === 'prod'
    });
  }

  public async emitInvoice(payload: GymInvoicePayload): Promise<ResultadoEmision> {
    const comprobante = resolverComprobante(this.config.taxCondition, payload.clientTaxCondition);
    const { neto, iva, importeTotal } = this.calcularImportes(payload.amount);
    const docNro = this.resolverDocNro(payload);
    const hoy = this.getTodayNumber();

    const data: Record<string, unknown> = {
      Concepto: this.CONCEPTO_SERVICIOS,
      DocTipo: comprobante.docType,
      DocNro: docNro,
      CbteTipo: comprobante.codigo,
      PtoVta: this.config.puntoVenta,
      ImpTotal: importeTotal,
      ImpTotConc: 0,
      ImpNeto: neto,
      ImpOpEx: 0,
      ImpTrib: 0,
      ImpIVA: iva,
      MonId: 'PES',
      MonCotiz: 1,
      CondicionIVAReceptorId: comprobante.condicionIVAReceptorId,
      // Fechas de servicio requeridas para Concepto=2 (Servicios).
      FchServDesde: hoy,
      FchServHasta: hoy,
      FchVtoPago: hoy
    };

    // La Factura C (monotributo) no discrimina IVA: no se manda el desglose.
    if (comprobante.codigo !== 11) {
      data.Iva = [{ Id: 5, BaseImp: neto, Importe: iva }];
    }

    let resultado: { CAE: string; CAEFchVto: string; voucherNumber: number };
    try {
      resultado = await this.afip.ElectronicBilling.createNextVoucher(data);
    } catch (error: any) {
      throw this.traducirError(error);
    }

    return {
      cae: resultado.CAE,
      vencimientoCae: this.parseFechaFormateada(resultado.CAEFchVto),
      numeroComprobante: resultado.voucherNumber,
      puntoVenta: this.config.puntoVenta,
      codigoTipoComprobante: comprobante.codigo,
      tipoComprobante: comprobante.nombre,
      neto,
      iva,
      importeTotal
    };
  }

  /** Igual criterio que el adaptador legacy: el monotributista no discrimina IVA. */
  private calcularImportes(amount: number) {
    if (this.config.taxCondition === GymTaxCondition.MONOTRIBUTO) {
      return { neto: amount, iva: 0, importeTotal: amount };
    }

    const neto = Number((amount / (1 + ALICUOTA_IVA)).toFixed(2));
    const iva = Number((amount - neto).toFixed(2));

    return { neto, iva, importeTotal: amount };
  }

  /**
   * DNI del socio salvo que sea Responsable Inscripto, en cuyo caso factura a
   * su propio CUIT (Factura A). La validación de que `resolverComprobante` y
   * `clientCuit` estén en sintonía debería hacerla quien arma el payload
   * (`EmitPendingInvoicesUseCase`); esto es una segunda barrera: un DocNro
   * vacío contra AFIP real no se puede deshacer con un rollback.
   */
  private resolverDocNro(payload: GymInvoicePayload): number {
    if (payload.clientTaxCondition === ClientTaxCondition.RESPONSABLE_INSCRIPTO) {
      if (payload.clientCuit === undefined) {
        throw new InvoiceEmissionError(
          'El socio es Responsable Inscripto pero no tiene CUIT cargado.',
          'validacion'
        );
      }
      return payload.clientCuit;
    }
    if (payload.clientDocument === undefined) {
      throw new InvoiceEmissionError('El socio no tiene DNI cargado.', 'validacion');
    }
    return payload.clientDocument;
  }

  /**
   * `createNextVoucher` tira tres formas de error distintas y hay que
   * distinguirlas para la política de reintentos:
   *  - `AfipWebServiceError` (tiene `code`, no `status`): AFIP mismo rechazó
   *    el comprobante (dato de la factura, cert/CUIT inválido) o la SDK
   *    reportó un `Errors` de su proxy. Nada de esto se arregla reintentando.
   *  - Error HTTP contra el proxy de AFIP SDK (tiene `status`, lo arma el
   *    interceptor de `Afip.js`): 4xx es config nuestra, 5xx es su servicio.
   *  - Cualquier otra cosa: timeout o corte de red.
   */
  private traducirError(error: any): InvoiceEmissionError {
    if (error && typeof error.code !== 'undefined' && typeof error.status === 'undefined') {
      return new InvoiceEmissionError(`AFIP_SDK_ERROR (${error.code}): ${error.message}`, 'validacion');
    }

    if (error && typeof error.status === 'number') {
      const tipo = error.status >= 500 ? 'servicio' : 'validacion';
      return new InvoiceEmissionError(`AFIP_SDK_HTTP_ERROR (${error.status}): ${error.message}`, tipo);
    }

    return new InvoiceEmissionError(
      `NETWORK_ERROR: ${error?.message ?? 'Timeout o desconexión contactando a AFIP SDK.'}`,
      'red'
    );
  }

  private getTodayNumber(): number {
    return Number(new Date().toISOString().split('T')[0].replace(/-/g, ''));
  }

  /**
   * `createNextVoucher` ya devuelve `CAEFchVto` formateada como `yyyy-mm-dd`
   * (la propia librería la convierte desde el `yyyymmdd` de AFIP), a
   * diferencia del adaptador legacy que recibía el crudo `yyyymmdd`.
   */
  private parseFechaFormateada(fecha: string): Date {
    const partes = String(fecha ?? '').split('-').map(Number);

    if (partes.length !== 3 || partes.some((parte) => Number.isNaN(parte))) {
      // Un vencimiento ilegible no invalida el CAE, que es lo que importa.
      return new Date();
    }

    const [year, month, day] = partes;
    return new Date(year, month - 1, day);
  }
}

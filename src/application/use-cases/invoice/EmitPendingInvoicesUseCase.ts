import { IInvoiceRepository } from '../../../domain/repositories/IInvoiceRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository, IGymSecretsRepository } from '../../../domain/repositories/IGymRepository';
import { IInvoiceProviderFactory } from '../../../domain/services/IInvoiceProviderFactory';
import { IOwnAccountInvoiceProviderFactory } from '../../../domain/services/IOwnAccountInvoiceProviderFactory';
import { IInvoiceProvider } from '../../../domain/services/IInvoiceProvider';
import { Invoice } from '../../../domain/entities/Invoice';
import { InvoiceEmissionError } from '../../../domain/billing/errors';
import { normalizarCuit, normalizarDocumento } from '../../../domain/billing/documentos';
import { ClientTaxCondition, GymInvoicePayload } from '../../../domain/billing/types';
import { env } from '../../../config/env';

/**
 * Cuántas facturas se emiten por tick. Las renovaciones son mensuales y llegan de a
 * poco: el tope está para que un backlog acumulado no monopolice el proceso ni
 * dispare cientos de llamadas seguidas a AFIP.
 */
const MAX_POR_TICK = 5;

/**
 * Intentos antes de dar el fallo por definitivo. Con el backoff de abajo, cinco
 * intentos cubren algo más de una hora de caída de AFIP.
 */
const MAX_INTENTOS = 5;

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAXIMO_MS = 30 * 60_000;

/**
 * Cuánto se reserva la factura mientras se la emite. Tiene que ser holgadamente
 * mayor que el timeout del adaptador (15s): si venciera antes, otro tick podría
 * tomar la misma factura mientras la primera llamada sigue viva y emitirla dos veces.
 */
export const LEASE_MS = 5 * 60_000;

/**
 * Techo de tiempo para una corrida. Existe por el disparador HTTP: el cron externo
 * corta la conexión a los 30s y un lote grande dejaría el request colgado hasta
 * que el cliente se va. Cortar por tiempo no pierde trabajo — las facturas que no
 * se alcanzaron siguen `pendiente` y las toma la corrida siguiente.
 */
const PRESUPUESTO_DEFAULT_MS = 25_000;

export interface OpcionesEmision {
  /** Cuántas facturas como mucho. El tick interno usa pocas y seguido; el cron, muchas y espaciado. */
  maxFacturas?: number;
  /** Corta el lote al superarse, aunque queden facturas y quede cupo. */
  presupuestoMs?: number;
}

export interface ResumenEmision {
  procesadas: number;
  emitidas: number;
  fallidas: number;
  /** `true` si quedó trabajo sin tocar por agotarse el cupo o el tiempo. */
  truncado: boolean;
}

/**
 * Emite las facturas que quedaron pendientes.
 *
 * Es el otro lado de la renovación: `RenewClientUseCase` deja el comprobante
 * encolado en estado `pendiente` y responde, y este caso de uso lo toma después.
 * Antes esto pasaba dentro del request del socio, que quedaba esperando hasta 15
 * segundos a AFIP para renovar una cuota.
 *
 * No sabe nada de temporizadores: quién lo llama y cada cuánto es problema del
 * scheduler de infraestructura. Así se lo puede correr también a mano o desde un
 * test sin levantar nada.
 */
export class EmitPendingInvoicesUseCase {
  constructor(
    private invoiceRepository: IInvoiceRepository,
    private gymRepository: IGymRepository,
    private gymSecretsRepo: IGymSecretsRepository,
    private clientRepository: IClientRepository,
    /** Modo `cuenta_propia` (activo por default). Ver `AFIP_BILLING_MODE`. */
    private ownAccountProviderFactory: IOwnAccountInvoiceProviderFactory,
    /** Modo `cuenta_unica`, DESCONECTADO. Se sigue recibiendo para no romper la
     * composition root ni perder la posibilidad de retomarlo. */
    private legacyProviderFactory: IInvoiceProviderFactory
  ) {}

  async execute(opciones: OpcionesEmision = {}): Promise<ResumenEmision> {
    const maxFacturas = opciones.maxFacturas ?? MAX_POR_TICK;
    const presupuestoMs = opciones.presupuestoMs ?? PRESUPUESTO_DEFAULT_MS;
    const limite = Date.now() + presupuestoMs;

    const resumen: ResumenEmision = { procesadas: 0, emitidas: 0, fallidas: 0, truncado: false };

    for (let i = 0; i < maxFacturas; i++) {
      // Se chequea ANTES de reclamar: tomar una factura y no llegar a emitirla la
      // deja reservada 5 minutos por el lease, retrasando su próximo intento sin
      // que nadie lo haya intentado siquiera.
      if (Date.now() >= limite) {
        resumen.truncado = true;
        break;
      }

      const factura = await this.invoiceRepository.claimPendiente(LEASE_MS);

      // No hay más trabajo: cortar en vez de seguir consultando en vano.
      if (!factura) return resumen;

      resumen.procesadas++;
      const emitida = await this.emitirUna(factura);
      if (emitida) {
        resumen.emitidas++;
      } else {
        resumen.fallidas++;
      }
    }

    // Se salió por cupo, no porque se acabara el trabajo: puede quedar cola.
    if (resumen.procesadas === maxFacturas) {
      resumen.truncado = true;
    }

    return resumen;
  }

  /** Devuelve `true` si la factura quedó emitida. Nunca lanza: un fallo no puede cortar el lote. */
  private async emitirUna(factura: Invoice): Promise<boolean> {
    try {
      const provider = await this.construirProvider(factura);
      const datosFiscales = await this.datosFiscalesDelSocio(factura);

      const payload: GymInvoicePayload = {
        amount: factura.monto,
        description: factura.descripcion ?? '',
        clientTaxCondition: datosFiscales.clientTaxCondition,
        clientDocument: datosFiscales.clientDocument,
        clientCuit: datosFiscales.clientCuit
      };

      const resultado = await provider.emitInvoice(payload);

      // La fecha de emisión es la del CAE, no la de la renovación: es el instante en
      // que el comprobante existe para AFIP.
      await this.invoiceRepository.marcarEmitida(factura.id, factura.gymId, resultado, new Date());
      console.log(`✅ Factura ${factura.id} emitida - CAE: ${resultado.cae}`);
      return true;
    } catch (error: any) {
      await this.registrarFallo(factura, error);
      return false;
    }
  }

  /**
   * Los problemas de configuración (facturación apagada, sin credencial, CUIT mal
   * cargado) se tratan como fallos de validación: reintentarlos solos no los
   * arregla, hace falta que alguien corrija el dato y reencole la factura.
   *
   * Bifurca por `AFIP_BILLING_MODE`: `cuenta_propia` (default) pide las tres
   * credenciales del gym; `cuenta_unica` (desconectado) sigue andando tal cual
   * estaba, por si se retoma.
   */
  private async construirProvider(factura: Invoice): Promise<IInvoiceProvider> {
    const gym = await this.gymRepository.findById(factura.gymId);

    if (!gym?.afipConfig?.isActive) {
      throw new InvoiceEmissionError(
        'La facturación AFIP no está activa para este gimnasio.',
        'validacion'
      );
    }

    const cuit = normalizarCuit(gym.cuit);
    if (cuit === null) {
      throw new InvoiceEmissionError(
        `El CUIT del gimnasio ("${gym.cuit}") no tiene 11 dígitos.`,
        'validacion'
      );
    }

    if (env.AFIP_BILLING_MODE === 'cuenta_unica') {
      // La credencial es de la plataforma, no del gym: si falta, no hay dato que el
      // dueño del gimnasio pueda corregir. Igual se clasifica como 'validacion' para
      // que no se reintente sola —reintentar sin credencial solo quema la cola—,
      // pero el mensaje apunta a dónde está el problema de verdad.
      const afipApiKey = await this.gymSecretsRepo.getAfipApiKey();
      if (!afipApiKey) {
        throw new InvoiceEmissionError(
          'AFIP_SDK_API_KEY no está configurada en la plataforma: ningún gimnasio puede facturar.',
          'validacion'
        );
      }

      return this.legacyProviderFactory.create({
        tenantId: factura.gymId,
        cuit,
        puntoVenta: gym.afipConfig.puntoVenta,
        taxCondition: gym.afipConfig.taxCondition,
        afipSdkApiKey: afipApiKey
      });
    }

    const credenciales = await this.gymSecretsRepo.getAfipCredentials(factura.gymId);
    if (!credenciales) {
      throw new InvoiceEmissionError(
        'El gimnasio no cargó su certificado, clave privada o API key de AFIP SDK. ' +
          'Hay que completarlos en Configuración > Facturación antes de poder emitir.',
        'validacion'
      );
    }

    return this.ownAccountProviderFactory.create({
      tenantId: factura.gymId,
      cuit,
      puntoVenta: gym.afipConfig.puntoVenta,
      taxCondition: gym.afipConfig.taxCondition,
      accessToken: credenciales.accessToken,
      cert: credenciales.cert,
      key: credenciales.key
    });
  }

  /**
   * DNI o CUIT del socio, según su condición fiscal. Consumidor Final/Monotributo
   * factura a su DNI; Responsable Inscripto factura a su propio CUIT (Factura A).
   * Es el dato que decide, junto con la condición del gym, qué comprobante emite
   * el adaptador de cuenta propia (`domain/billing/types.resolverComprobante`).
   */
  private async datosFiscalesDelSocio(factura: Invoice): Promise<{
    clientDocument?: number;
    clientCuit?: number;
    clientTaxCondition: ClientTaxCondition;
  }> {
    const cliente = await this.clientRepository.findById(factura.clientId, factura.gymId);

    if (!cliente) {
      throw new InvoiceEmissionError('El socio de la factura ya no existe.', 'validacion');
    }

    const clientTaxCondition = cliente.condicionFiscal ?? ClientTaxCondition.CONSUMIDOR_FINAL;

    if (clientTaxCondition === ClientTaxCondition.RESPONSABLE_INSCRIPTO) {
      const clientCuit = normalizarCuit(cliente.cuit ?? '');
      if (clientCuit === null) {
        throw new InvoiceEmissionError(
          `El socio es Responsable Inscripto pero su CUIT ("${cliente.cuit ?? ''}") no es válido.`,
          'validacion'
        );
      }
      return { clientTaxCondition, clientCuit };
    }

    const documento = normalizarDocumento(cliente.documento);
    if (documento === null) {
      throw new InvoiceEmissionError(
        `El documento del socio ("${cliente.documento}") no es un DNI válido.`,
        'validacion'
      );
    }

    return { clientDocument: documento, clientTaxCondition };
  }

  /**
   * Decide si la factura vuelve a la cola o si el fallo es definitivo. Un error que
   * no sea `InvoiceEmissionError` es un bug nuestro, no de AFIP: se trata como
   * transitorio para no descartar un comprobante por una excepción inesperada.
   */
  private async registrarFallo(factura: Invoice, error: any): Promise<void> {
    const esTransitorio =
      error instanceof InvoiceEmissionError ? error.esTransitorio : true;

    const mensaje = error?.message ?? String(error);
    const quedanIntentos = factura.intentos < MAX_INTENTOS;

    if (esTransitorio && quedanIntentos) {
      const proximoIntento = new Date(Date.now() + this.backoff(factura.intentos));
      await this.invoiceRepository.marcarFallo(factura.id, factura.gymId, {
        estado: 'pendiente',
        errorLog: mensaje,
        proximoIntento
      });
      console.warn(
        `⏳ Factura ${factura.id}: intento ${factura.intentos}/${MAX_INTENTOS} falló, reintenta a las ${proximoIntento.toISOString()}`
      );
      return;
    }

    await this.invoiceRepository.marcarFallo(factura.id, factura.gymId, {
      estado: 'error',
      errorLog: mensaje
    });
    console.error(`❌ Factura ${factura.id} en error definitivo: ${mensaje}`);
  }

  /** Backoff exponencial con techo, contando desde el primer intento fallido. */
  private backoff(intentos: number): number {
    const espera = BACKOFF_BASE_MS * 2 ** Math.max(0, intentos - 1);
    return Math.min(espera, BACKOFF_MAXIMO_MS);
  }
}

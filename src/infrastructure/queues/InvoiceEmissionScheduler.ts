import { EmitPendingInvoicesUseCase } from '../../application/use-cases/invoice/EmitPendingInvoicesUseCase';

/**
 * Cada cuánto se busca trabajo. Las renovaciones son mensuales y entran de a una,
 * así que no hace falta apurar: quince segundos de latencia en una factura no los
 * nota nadie, y el intervalo corto solo serviría para consultar la base en vano.
 */
const INTERVALO_DEFAULT_MS = 15_000;

/**
 * Worker de facturación in-process.
 *
 * Reemplaza al `invoiceWorker` viejo, que era un `Worker` de BullMQ contra Redis:
 * la cola vive en la propia colección de facturas (`estado: 'pendiente'`), así que
 * no hace falta un broker aparte ni mantener sincronizados dos lugares donde puede
 * estar la verdad. El estado sobrevive a los reinicios porque está en Mongo, que es
 * lo que un fire-and-forget en memoria no daba.
 *
 * Es infraestructura pura: solo decide CUÁNDO se trabaja. Qué se hace con cada
 * factura es del `EmitPendingInvoicesUseCase`.
 */
export class InvoiceEmissionScheduler {
  private timer?: NodeJS.Timeout;
  private tickEnCurso = false;

  constructor(
    private emitPendingInvoices: EmitPendingInvoicesUseCase,
    private intervaloMs: number = INTERVALO_DEFAULT_MS
  ) {}

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervaloMs);

    // `unref` para que el worker no sea motivo suficiente para mantener vivo al
    // proceso: si el server se cierra, no queda un timer impidiendo la salida.
    this.timer.unref();

    console.log(`🧾 Worker de facturación activo (cada ${this.intervaloMs / 1000}s)`);
  }

  stop(): void {
    if (!this.timer) return;

    clearInterval(this.timer);
    this.timer = undefined;
    // No se espera al tick en curso: si el proceso muere en la mitad de una
    // emisión, la factura queda reservada hasta que vence su lease y otro la toma.
    console.log('✅ Worker de facturación detenido');
  }

  /**
   * Un tick por vez. Sin esta guarda, una tanda lenta —AFIP demorando cerca del
   * timeout— haría que el siguiente intervalo entrara encima del anterior y se
   * fueran apilando ticks concurrentes.
   */
  private async tick(): Promise<void> {
    if (this.tickEnCurso) return;
    this.tickEnCurso = true;

    try {
      const resumen = await this.emitPendingInvoices.execute();

      if (resumen.procesadas > 0) {
        console.log(
          `🧾 Facturación: ${resumen.procesadas} procesadas (${resumen.emitidas} emitidas, ${resumen.fallidas} con fallo)`
        );
      }
    } catch (error) {
      // El caso de uso ya absorbe los fallos de cada factura; si algo llega hasta
      // acá es un problema del lote entero (la base, por ejemplo). Se registra y el
      // worker sigue vivo para el próximo tick.
      console.error('❌ Tick del worker de facturación falló:', error);
    } finally {
      this.tickEnCurso = false;
    }
  }
}

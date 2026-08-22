/**
 * Proveedor de pagos ya configurado para un tenant (el access token del gym se
 * inyecta al crearlo vía `IPaymentProviderFactory`). Aquí solo se genera el link y
 * se consulta un pago — mismo recorte de responsabilidad que `IInvoiceProvider`.
 */
export interface IPaymentProvider {
  /**
   * Identifica a qué cuenta de Mercado Pago pertenece este access token.
   *
   * Se usa al cargar la credencial (`UpdateMercadoPagoCredentialsUseCase`) para
   * capturar el `mpUserId` automáticamente en vez de pedírselo al dueño del gym
   * a mano — y de paso, validar que el token realmente sirve antes de guardarlo.
   */
  obtenerCuenta(): Promise<{ userId: string }>;

  crearLinkPago(dto: {
    /** Ata el pago que resulte de este link con el `RenewalRequest` que lo pidió. */
    externalReference: string;
    monto: number;
    descripcion: string;
  }): Promise<{ paymentLinkId: string; initPoint: string }>;

  /**
   * Trae el pago REAL desde Mercado Pago. Se usa para confirmar un webhook: nunca
   * se aplica una renovación solo por lo que dice el body de la notificación.
   */
  obtenerPago(paymentId: string): Promise<{
    id: string;
    status: 'approved' | 'pending' | 'rejected' | 'cancelled' | 'in_process' | 'refunded' | string;
    externalReference?: string;
    transactionAmount: number;
  }>;
}

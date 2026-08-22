import axios from 'axios';
import { IPaymentProvider } from '../../../domain/services/IPaymentProvider';
import { ExternalServiceError } from '../../../shared/errors/AppError';

const MP_API_BASE = 'https://api.mercadopago.com';
const TIMEOUT_MS = 15_000;

/**
 * Adaptador de la cuenta PROPIA de cada gym (OAuth), vía Checkout Pro.
 *
 * Se usa `POST /checkout/preferences` (no `/v1/payment_links`, que es un producto
 * separado con menos control sobre `notification_url`/`back_urls`): la preferencia
 * es el objeto estándar de Mercado Pago para "cobrar un ítem con un link", trae
 * `init_point` para compartir con el pagador y acepta `external_reference` para
 * reconciliar el pago con este pedido — verificado contra la documentación pública
 * de Checkout Pro, no asumido.
 *
 * `axios` directo, mismo estilo que `MetaCloudApiProvider`: sin sumar el SDK npm
 * `mercadopago` a las dependencias.
 */
export class MercadoPagoAdapter implements IPaymentProvider {
  constructor(private readonly accessToken: string) {}

  /**
   * `GET /users/me` con el access token propio del gym. Sirve dos propósitos a
   * la vez: valida que el token es real (si no, MP responde 401 y esto lanza)
   * y devuelve el `id` de la cuenta, que es el `user_id` que después trae el
   * webhook de un pago.
   */
  async obtenerCuenta(): Promise<{ userId: string }> {
    try {
      const { data } = await axios.get(`${MP_API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        timeout: TIMEOUT_MS
      });

      return { userId: String(data.id) };
    } catch (error: any) {
      throw this.traducirError(error);
    }
  }

  async crearLinkPago(dto: {
    externalReference: string;
    monto: number;
    descripcion: string;
  }): Promise<{ paymentLinkId: string; initPoint: string }> {
    try {
      const { data } = await axios.post(
        `${MP_API_BASE}/checkout/preferences`,
        {
          external_reference: dto.externalReference,
          items: [
            {
              title: dto.descripcion,
              quantity: 1,
              currency_id: 'ARS',
              unit_price: dto.monto
            }
          ]
        },
        {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          timeout: TIMEOUT_MS
        }
      );

      return { paymentLinkId: data.id, initPoint: data.init_point };
    } catch (error: any) {
      throw this.traducirError(error);
    }
  }

  async obtenerPago(paymentId: string): Promise<{
    id: string;
    status: string;
    externalReference?: string;
    transactionAmount: number;
  }> {
    try {
      const { data } = await axios.get(`${MP_API_BASE}/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        timeout: TIMEOUT_MS
      });

      return {
        id: String(data.id),
        status: data.status,
        externalReference: data.external_reference ?? undefined,
        transactionAmount: data.transaction_amount
      };
    } catch (error: any) {
      throw this.traducirError(error);
    }
  }

  /**
   * A diferencia de la facturación AFIP, acá no hay una cola con reintentos: la
   * creación del link es síncrona dentro del request del operador, así que alcanza
   * con un error clasificado por status para que el controller devuelva el código
   * correcto (502 = "el de afuera falló", no un 500 genérico).
   */
  private traducirError(error: any): ExternalServiceError {
    const status = error?.response?.status;
    const detalle = error?.response?.data?.message ?? error?.message ?? 'Error desconocido';
    return new ExternalServiceError(
      `MERCADOPAGO_ERROR${status ? ` (${status})` : ''}: ${detalle}`
    );
  }
}

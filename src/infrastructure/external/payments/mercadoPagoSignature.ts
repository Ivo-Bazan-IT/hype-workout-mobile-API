import { createHmac, createHash, timingSafeEqual } from 'crypto';

/**
 * Compara en tiempo constante, sin filtrar la longitud del secreto. Mismo
 * criterio que `internalAuthMiddleware`: `timingSafeEqual` lanza si los buffers
 * miden distinto, así que se hashea a un tamaño fijo antes de comparar.
 */
const igualEnTiempoConstante = (a: string, b: string): boolean => {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
};

/**
 * Valida la firma `x-signature` de un webhook de Mercado Pago.
 *
 * Formato del header: `ts=<timestamp>,v1=<hmac>`. El `v1` es un HMAC-SHA256,
 * calculado sobre el manifest `id:{data.id};request-id:{x-request-id};ts:{ts};`
 * con el secreto de la aplicación (Mercado Pago Developers > la app > Webhooks >
 * Configurar notificaciones).
 *
 * ⚠️ El formato del header (`ts=…,v1=…`) está confirmado contra la documentación
 * pública de Mercado Pago; el manifest exacto de más arriba es el que publican
 * sus guías de implementación, pero no se pudo confirmar contra un webhook real
 * en esta implementación (no hay cuenta de prueba conectada todavía). Verificar
 * contra el primer webhook real que llegue, con el secreto en
 * `MERCADOPAGO_WEBHOOK_SECRET` — mismo criterio de diligencia que se usó para
 * `AfipSdkOwnAccountAdapter`.
 */
export const verificarFirmaMercadoPago = (params: {
  xSignature: string;
  xRequestId: string;
  dataId: string;
  secret: string;
}): boolean => {
  const partes = Object.fromEntries(
    params.xSignature
      .split(',')
      .map((par) => par.split('='))
      .map(([key, value]) => [key?.trim(), value?.trim()])
  );

  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) {
    return false;
  }

  const manifest = `id:${params.dataId};request-id:${params.xRequestId};ts:${ts};`;
  const hmac = createHmac('sha256', params.secret).update(manifest).digest('hex');

  return igualEnTiempoConstante(hmac, v1);
};

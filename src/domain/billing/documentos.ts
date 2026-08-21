/**
 * Normalización de documentos para facturar.
 *
 * El CUIT del gym y el documento del socio se cargan a mano, así que llegan de
 * cualquier forma: `20-12345678-9`, `20.123.456.789`, con espacios. AFIP los quiere
 * como número pelado.
 *
 * Esto existía como `parseInt(gym.cuit)`, que ante `"20-12345678-9"` no falla:
 * devuelve `20` y sigue como si nada. Un CUIT truncado no se detecta mirando el
 * código, se detecta cuando AFIP rechaza la factura —o peor, cuando la emite a
 * nombre de otro—, así que acá se valida el largo y se falla fuerte.
 */

const soloDigitos = (valor: string): string => String(valor ?? '').replace(/\D/g, '');

/** `null` si no quedan 11 dígitos, que es lo único que AFIP acepta como CUIT. */
export const normalizarCuit = (cuit: string): number | null => {
  const digitos = soloDigitos(cuit);
  return digitos.length === 11 ? Number(digitos) : null;
};

/**
 * DNI del socio. Se acepta de 7 u 8 dígitos: hay documentos viejos de 7 y
 * rechazarlos dejaría sin facturar a socios reales.
 */
export const normalizarDocumento = (documento: string): number | null => {
  const digitos = soloDigitos(documento);
  return digitos.length >= 7 && digitos.length <= 8 ? Number(digitos) : null;
};

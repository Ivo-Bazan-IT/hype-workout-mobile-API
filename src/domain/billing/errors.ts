import { AppError } from '../../shared/errors/AppError';

/**
 * Por qué falló la emisión. Es lo único que la política de reintentos necesita
 * saber, y por eso viaja como dato y no como texto:
 *
 * - `validacion`: AFIP rechazó el comprobante por su contenido (CUIT mal cargado,
 *   punto de venta inexistente, importe discordante). Reintentar lo mismo va a
 *   fallar igual las veces que haga falta; hay que corregir el dato primero.
 * - `servicio`: los servidores de AFIP contestaron con un 5xx. Es transitorio.
 * - `red`: timeout o desconexión, no sabemos si el comprobante llegó a emitirse.
 *
 * Antes esta distinción se hacía con `error.message.includes('AFIP_API_SERVER_ERROR')`
 * desde el worker: cualquier retoque al texto del mensaje cambiaba en silencio el
 * comportamiento de los reintentos.
 */
export type TipoFalloEmision = 'validacion' | 'servicio' | 'red';

/** Los fallos que tiene sentido reintentar solos. */
const TRANSITORIOS: TipoFalloEmision[] = ['servicio', 'red'];

export class InvoiceEmissionError extends AppError {
  constructor(
    message: string,
    public readonly tipo: TipoFalloEmision
  ) {
    // 502: el que falló es el de afuera, no este backend.
    super(message, 502);
  }

  get esTransitorio(): boolean {
    return TRANSITORIOS.includes(this.tipo);
  }
}

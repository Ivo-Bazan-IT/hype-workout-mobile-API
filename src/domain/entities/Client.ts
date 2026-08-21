import { Types } from 'mongoose';
import { ClientTaxCondition } from '../billing/types';

export type ClientStatus = 'activo' | 'inactivo' | 'pendiente';

export interface RenewalHistory {
  fecha: Date;
  monto: number;
}

export interface Client {
  id: string;
  gymId: string;
  nombre: string;
  documento: string;
  // Opcional: un cliente puede darse de alta solo con nombre y documento, y
  // completarse después con la encuesta (PATCH /api/clients/:id/encuesta).
  telefono?: string;
  email?: string;
  estado: ClientStatus;
  fechaInicio: Date;
  fechaVencimiento: Date;
  esRecurrente: boolean;
  historialRenovaciones: RenewalHistory[];
  encuestaData?: Record<string, any>;
  /**
   * Cuándo se completó la encuesta por primera vez, o sea cuándo este lead se
   * convirtió en socio. Es el sello del embudo (KPI 4.2).
   *
   * No se deriva de `updatedAt`: cualquier edición posterior lo pisaría y la
   * conversión quedaría imputada al mes equivocado. Se graba una sola vez y no se
   * vuelve a tocar, ni siquiera si la encuesta se completa en varias tandas.
   *
   * `undefined` en dos casos distintos que hay que saber distinguir: el cliente
   * todavía no contestó (sigue siendo lead), o convirtió antes de que el campo
   * existiera. Para el segundo, `encuestaData` está presente: se lo cuenta como
   * convertido con fecha desconocida y no se le inventa un período.
   */
  fechaConversion?: Date;
  /**
   * Cuándo el gimnasio contactó por primera vez a este lead (KPI 4.3). Lo graba
   * `POST /api/clients/:id/contacto` y, como el nombre indica, solo la primera vez.
   */
  fechaPrimerContacto?: Date;
  /**
   * Cuándo se le mandó al socio el formulario de ingreso por WhatsApp.
   *
   * Es el paso que faltaba entre el alta y la encuesta: sin este sello, el listado
   * no puede distinguir "todavía no le mandé nada" de "se lo mandé y estoy esperando
   * que conteste", que son dos situaciones con acciones distintas.
   *
   * A diferencia de `fechaPrimerContacto`, **se pisa en cada reenvío**: acá la
   * pregunta es "¿cuándo fue la última vez que le insistí?" y no "¿cuándo fue la
   * primera?". La primera vez que se manda, además, sella el primer contacto — porque
   * mandarle el formulario ES contactarlo.
   *
   * Marca cuándo el CRM disparó el envío, no cuándo el socio recibió el mensaje: el
   * mensaje lo termina de mandar una persona desde su WhatsApp, y de ese lado el
   * sistema no ve nada.
   */
  fechaFormularioEnviado?: Date;
  /**
   * Condición fiscal del socio ante AFIP. Decide, junto con la condición del
   * gimnasio, qué comprobante le corresponde (`domain/billing/types.resolverComprobante`):
   * Responsable Inscripto factura A a su CUIT, cualquier otro caso factura B o C
   * a su DNI. `undefined` en los clientes cargados antes de este campo se trata
   * como `CONSUMIDOR_FINAL` — es la condición de la enorme mayoría de los socios,
   * y no se le puede preguntar a un dato que no existe.
   */
  condicionFiscal?: ClientTaxCondition;
  /** CUIT del socio. Solo hace falta (y se exige) cuando es Responsable Inscripto. */
  cuit?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Si el cliente contestó la encuesta. Ese es el salto que define la conversión del
 * embudo en este CRM: no hay entidad `Lead` separada, un `Client` sin encuesta ES
 * el lead.
 *
 * Exige al menos una respuesta y no la mera presencia del objeto: un `{}` que
 * quedó de una escritura parcial no es una encuesta contestada, y contarlo como
 * conversión inflaría el KPI sin que nadie pueda ver por qué.
 */
export const tieneEncuestaCompleta = (
  encuestaData?: Record<string, any> | null
): boolean =>
  encuestaData !== undefined &&
  encuestaData !== null &&
  Object.keys(encuestaData).length > 0;

export class ClientEntity implements Client {
  constructor(
    public id: string,
    public gymId: string,
    public nombre: string,
    public documento: string,
    public telefono: string | undefined,
    public estado: ClientStatus = 'pendiente',
    public fechaInicio: Date = new Date(),
    public fechaVencimiento: Date = new Date(),
    public esRecurrente: boolean = false,
    public historialRenovaciones: RenewalHistory[] = [],
    public email?: string,
    public encuestaData?: Record<string, any>,
    public fechaConversion?: Date,
    public fechaPrimerContacto?: Date,
    public fechaFormularioEnviado?: Date,
    public condicionFiscal?: ClientTaxCondition,
    public cuit?: string,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class ClientMapper {
  static toDomain(doc: any): Client {
    return new ClientEntity(
      doc._id.toString(),
      doc.gymId.toString(),
      doc.nombre,
      doc.documento,
      doc.telefono,
      doc.estado,
      doc.fechaInicio,
      doc.fechaVencimiento,
      doc.esRecurrente,
      doc.historialRenovaciones,
      doc.email,
      doc.encuestaData,
      doc.fechaConversion,
      doc.fechaPrimerContacto,
      doc.fechaFormularioEnviado,
      doc.condicionFiscal,
      doc.cuit,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: ClientEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      nombre: entity.nombre,
      documento: entity.documento,
      telefono: entity.telefono,
      email: entity.email,
      estado: entity.estado,
      fechaInicio: entity.fechaInicio,
      fechaVencimiento: entity.fechaVencimiento,
      esRecurrente: entity.esRecurrente,
      historialRenovaciones: entity.historialRenovaciones,
      encuestaData: entity.encuestaData,
      fechaConversion: entity.fechaConversion,
      fechaPrimerContacto: entity.fechaPrimerContacto,
      fechaFormularioEnviado: entity.fechaFormularioEnviado,
      condicionFiscal: entity.condicionFiscal,
      cuit: entity.cuit,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
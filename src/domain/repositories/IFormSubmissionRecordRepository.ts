import { FormSubmissionRecord } from '../entities/FormSubmissionRecord';

/** Lo que `GET /api/onboarding/status` necesita saber de la integración. */
export interface FormSubmissionStats {
  /** Total histórico de submissions recibidas por el gym. */
  total: number;
  procesadas: number;
  rechazadas: number;
  /** La más reciente, o `null` si el gym nunca recibió ninguna. */
  ultima: FormSubmissionRecord | null;
  /** Las últimas rechazadas, para poder actuar sobre ellas. */
  ultimosRechazos: FormSubmissionRecord[];
}

export interface IFormSubmissionRecordRepository {
  /**
   * La submission ya procesada con ese `responseId`, o `null`.
   *
   * Filtra por `gymId` además del id de respuesta: los ids los genera Google, no
   * nosotros, y no hay garantía de unicidad entre formularios de distintos gyms.
   */
  findByResponseId(gymId: string, responseId: string): Promise<FormSubmissionRecord | null>;

  /**
   * Deja asentada una submission. Si ya había una con el mismo `responseId`, la
   * PISA en vez de insertar otra.
   *
   * Sobrescribir es lo que habilita la única recuperación posible de un rechazo: la
   * submission que rebotó porque el DNI no existía se reenvía desde el formulario
   * una vez dado de alta el socio, y llega con el mismo `responseId` de siempre. Si
   * esto insertara, chocaría contra el índice único y el reenvío fallaría justo en
   * el caso para el que existe.
   */
  registrar(
    record: Omit<FormSubmissionRecord, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<FormSubmissionRecord>;

  getStats(gymId: string, ultimosRechazos: number): Promise<FormSubmissionStats>;
}

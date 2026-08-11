import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { MembershipEventModel } from '../../src/infrastructure/database/mongoose/schemas/MembershipEventSchema';

/**
 * KPIs del dashboard de punta a punta, contra la API y la base reales.
 *
 * Los tests del caso de uso corren con mocks del puerto: verifican las cuentas, no que
 * el stream de eventos se escriba de verdad. Acá se cierra ese hueco — el alta, la
 * renovación y el ajuste tienen que dejar su evento al pasar por el endpoint, porque
 * de ese rastro salen el churn, el MRR y los ingresos. Si un caso de uso se olvidara
 * de emitirlo, todo seguiría respondiendo 200 y el socio simplemente no existiría
 * para el tablero.
 */
describe('KPIs del dashboard (e2e)', () => {
  let app: Application;

  const gymId = new Types.ObjectId().toString();
  const otroGymId = new Types.ObjectId().toString();

  const tokenDe = (gym: string) =>
    jwt.sign(
      { userId: 'user-1', email: 'dueno@hype.com', role: 'gym', gymId: gym },
      env.JWT_ACCESS_SECRET
    );

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${tokenDe(gymId)}`);

  beforeAll(async () => {
    app = await createApp();
  });

  const crearSocio = async (input: {
    documento: string;
    fechaInicio?: string;
    fechaVencimiento?: string;
  }): Promise<string> => {
    const res = await auth(request(app).post('/api/clients'))
      .send({
        nombre: `Socio ${input.documento}`,
        documento: input.documento,
        fechaInicio: input.fechaInicio,
        fechaVencimiento: input.fechaVencimiento,
      })
      .expect(201);

    return res.body.data.id;
  };

  const pedirKpis = async (query: Record<string, string> = {}) => {
    const res = await auth(request(app).get('/api/dashboard/kpis').query(query)).expect(200);
    return res.body.data;
  };

  /**
   * ⏰ ESTE FIXTURE CADUCA. Sus fechas son literales de 2026 y varias aserciones las
   * comparan contra el reloj real (`new Date()`), así que el resultado cambia solo con
   * el paso del tiempo. En concreto: B vence el **31/12/2026**, y a partir de enero de
   * 2027 pasa a contar como de baja — `clientesActivos` cae a 0, `socios.activos`
   * también, y varios tests se ponen en rojo sin que nadie haya tocado el código.
   *
   * Si estás leyendo esto porque la suite se puso roja sola: no es una regresión. El
   * arreglo es derivar las fechas de `now` o congelar el reloj con `vi.setSystemTime`,
   * no correr los literales un año más adelante.
   *
   * Escenario base: uno que se fue en febrero y uno que sigue.
   *
   * A: alta 01/01, vence 01/02 y no renueva. Con 5 días de gracia, su baja queda
   *    firme el 06/02 — dentro de febrero.
   * B: alta 01/01 con vencimiento a fin de año: sigue siendo socio hoy.
   */
  const sembrarEscenario = async (): Promise<{ a: string; b: string }> => ({
    a: await crearSocio({
      documento: '50000001',
      fechaInicio: '2026-01-01',
      fechaVencimiento: '2026-02-01',
    }),
    b: await crearSocio({
      documento: '50000002',
      fechaInicio: '2026-01-01',
      fechaVencimiento: '2026-12-31',
    }),
  });

  const FEBRERO = { desde: '2026-02-01', hasta: '2026-03-01' };

  describe('contrato de la respuesta', () => {
    it('devuelve los cinco bloques con su forma completa', async () => {
      await sembrarEscenario();

      const kpis = await pedirKpis(FEBRERO);

      expect(Object.keys(kpis).sort()).toEqual([
        'datosCompletosDesde',
        'embudo',
        'engagement',
        'financiero',
        'periodo',
        'retencion',
        'socios',
      ]);
      expect(Object.keys(kpis.socios).sort()).toEqual([
        'activos',
        'altasEnPeriodo',
        'bajasEnPeriodo',
        'crecimientoNeto',
        'enGracia',
      ]);
      expect(Object.keys(kpis.retencion).sort()).toEqual([
        'churnMensual',
        'cohorte90Dias',
        'tasaRetencion',
      ]);
      expect(Object.keys(kpis.financiero).sort()).toEqual([
        'arpu',
        'ingresosPeriodo',
        'ltv',
        'mrr',
      ]);
      expect(Object.keys(kpis.engagement).sort()).toEqual([
        'enRiesgo',
        'registroDesde',
        'visitasPorSocioPorSemana',
      ]);
      expect(Object.keys(kpis.embudo).sort()).toEqual([
        'conversionesEnPeriodo',
        'leadsNuevos',
        'leadsPorSemana',
        'sinContactar',
        'sinConvertir',
        'tasaConversion',
        'tiempoRespuestaMinutos',
        'ventanaConversionDias',
      ]);
    });

    // El mes en curso se corta a medianoche UTC, no en la zona del proceso: el mismo
    // request tiene que devolver el mismo período en un contenedor UTC y en una
    // máquina argentina.
    it('usa el mes calendario en curso, cortado en UTC, cuando no se pide período', async () => {
      await sembrarEscenario();

      const kpis = await pedirKpis();
      const ahora = new Date();

      expect(new Date(kpis.periodo.desde)).toEqual(
        new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1))
      );
      expect(new Date(kpis.periodo.hasta)).toEqual(
        new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 1))
      );
    });

    it('devuelve el período pedido tal cual', async () => {
      await sembrarEscenario();

      const kpis = await pedirKpis(FEBRERO);

      expect(new Date(kpis.periodo.desde)).toEqual(new Date('2026-02-01'));
      expect(new Date(kpis.periodo.hasta)).toEqual(new Date('2026-03-01'));
    });

    it('rechaza un rango invertido (400)', async () => {
      await auth(
        request(app)
          .get('/api/dashboard/kpis')
          .query({ desde: '2026-03-01', hasta: '2026-02-01' })
      ).expect(400);
    });

    it('rechaza desde y hasta iguales (400)', async () => {
      await auth(
        request(app)
          .get('/api/dashboard/kpis')
          .query({ desde: '2026-02-01', hasta: '2026-02-01' })
      ).expect(400);
    });

    it('rechaza un desde suelto, sin su hasta (400)', async () => {
      await auth(
        request(app).get('/api/dashboard/kpis').query({ desde: '2026-02-01' })
      ).expect(400);
    });

    it('exige autenticación (401)', async () => {
      await request(app).get('/api/dashboard/kpis').expect(401);
    });

    it('responde con todo en cero para un gym sin socios, sin romper', async () => {
      const kpis = await pedirKpis(FEBRERO);

      expect(kpis.datosCompletosDesde).toBeNull();
      expect(kpis.socios.activos).toBe(0);
      expect(kpis.retencion.churnMensual).toBeNull();
      expect(kpis.financiero.ingresosPeriodo).toBe(0);
      expect(kpis.financiero.mrr).toBe(0);
      expect(kpis.financiero.arpu).toBeNull();
      expect(kpis.engagement.registroDesde).toBeNull();
    });
  });

  describe('retención con datos reales', () => {
    it('calcula churn, retención y crecimiento neto sobre la base al inicio del período', async () => {
      await sembrarEscenario();

      const kpis = await pedirKpis(FEBRERO);

      // Al 01/02 los dos eran socios (A vence justo ese día y todavía cuenta).
      // Durante febrero A causa baja firme el 06/02; B sigue.
      expect(kpis.socios.bajasEnPeriodo).toBe(1);
      expect(kpis.socios.altasEnPeriodo).toBe(0);
      expect(kpis.socios.crecimientoNeto).toBe(-1);
      expect(kpis.retencion.churnMensual).toBe(0.5);
      expect(kpis.retencion.tasaRetencion).toBe(0.5);
    });

    it('cuenta como activo de hoy solo al que sigue vigente', async () => {
      await sembrarEscenario();

      const kpis = await pedirKpis(FEBRERO);

      // `activos` es puntual a hoy, no del período: A hace meses que está de baja.
      expect(kpis.socios.activos).toBe(1);
      expect(kpis.socios.enGracia).toBe(0);
    });

    it('imputa el alta al período en que ocurre', async () => {
      await sembrarEscenario();
      await crearSocio({
        documento: '50000003',
        fechaInicio: '2026-02-10',
        fechaVencimiento: '2026-12-31',
      });

      const kpis = await pedirKpis(FEBRERO);

      expect(kpis.socios.altasEnPeriodo).toBe(1);
      // La retención excluye las altas nuevas: si no, un mes de mucha adquisición
      // taparía la fuga.
      expect(kpis.retencion.tasaRetencion).toBe(0.5);
    });

    it('devuelve la retención en null para un período anterior al corte de datos', async () => {
      await sembrarEscenario();

      // El primer evento del gym es de 2026-01-01: antes de eso no se sabe quién
      // estaba activo, y el dato no se estima.
      const kpis = await pedirKpis({ desde: '2025-01-01', hasta: '2025-02-01' });

      expect(kpis.retencion.churnMensual).toBeNull();
      expect(kpis.retencion.tasaRetencion).toBeNull();
      expect(kpis.retencion.cohorte90Dias).toBeNull();
      expect(kpis.socios.bajasEnPeriodo).toBeNull();
      expect(kpis.socios.crecimientoNeto).toBeNull();

      // El corte sí viaja, para que el dashboard pueda explicar por qué no hay número.
      expect(new Date(kpis.datosCompletosDesde)).toEqual(new Date('2026-01-01'));
    });

    it('no mezcla los socios de otro gym', async () => {
      await sembrarEscenario();

      const res = await request(app)
        .get('/api/dashboard/kpis')
        .set('Authorization', `Bearer ${tokenDe(otroGymId)}`)
        .query(FEBRERO)
        .expect(200);

      expect(res.body.data.socios.activos).toBe(0);
      expect(res.body.data.datosCompletosDesde).toBeNull();
    });
  });

  describe('el stream de eventos que alimenta los KPIs', () => {
    const eventosDe = (clientId: string) =>
      MembershipEventModel.find({ clientId }).sort({ fecha: 1 });

    it('el alta emite su evento con la ventana correcta', async () => {
      const clientId = await crearSocio({
        documento: '51000001',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-02-01',
      });

      const eventos = await eventosDe(clientId);

      expect(eventos).toHaveLength(1);
      expect(eventos[0].tipo).toBe('alta');
      expect(eventos[0].fecha).toEqual(new Date('2026-01-01'));
      expect(eventos[0].vencimientoNuevo).toEqual(new Date('2026-02-01'));
      // El alta no registra cobro: la plata entra al renovar.
      expect(eventos[0].monto).toBeUndefined();
      expect(eventos[0].origen).toBe('operacion');
    });

    it('mover el vencimiento a mano emite un ajuste auditable', async () => {
      const clientId = await crearSocio({
        documento: '51000002',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-02-01',
      });

      await auth(request(app).put(`/api/clients/${clientId}`))
        .send({ fechaVencimiento: '2026-03-01' })
        .expect(200);

      const eventos = await eventosDe(clientId);
      const ajuste = eventos.find((e) => e.tipo === 'ajuste');

      expect(ajuste).toBeDefined();
      expect(ajuste!.vencimientoAnterior).toEqual(new Date('2026-02-01'));
      expect(ajuste!.vencimientoNuevo).toEqual(new Date('2026-03-01'));
      // Corre la ventana sin cobro de por medio.
      expect(ajuste!.monto).toBeUndefined();
    });

    it('no emite ajuste cuando la edición no toca el vencimiento', async () => {
      const clientId = await crearSocio({
        documento: '51000003',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-02-01',
      });

      await auth(request(app).put(`/api/clients/${clientId}`))
        .send({ nombre: 'Nombre Corregido' })
        .expect(200);

      const eventos = await eventosDe(clientId);
      expect(eventos.filter((e) => e.tipo === 'ajuste')).toHaveLength(0);
    });

    it('no emite ajuste cuando se reenvía el mismo vencimiento', async () => {
      const clientId = await crearSocio({
        documento: '51000004',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-02-01',
      });

      await auth(request(app).put(`/api/clients/${clientId}`))
        .send({ fechaVencimiento: '2026-02-01' })
        .expect(200);

      const eventos = await eventosDe(clientId);
      expect(eventos.filter((e) => e.tipo === 'ajuste')).toHaveLength(0);
    });

    it('la renovación emite su evento con el monto y las dos puntas de la ventana', async () => {
      const clientId = await crearSocio({
        documento: '51000005',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-02-01',
      });

      await auth(request(app).post(`/api/clients/${clientId}/renew`))
        .send({ monto: 30000 })
        .expect(200);

      const eventos = await eventosDe(clientId);
      const renovacion = eventos.find((e) => e.tipo === 'renovacion');

      expect(renovacion).toBeDefined();
      expect(renovacion!.monto).toBe(30000);
      expect(renovacion!.vencimientoAnterior).toEqual(new Date('2026-02-01'));
      expect(renovacion!.vencimientoNuevo).toBeDefined();
    });

    it('registra la renovación aunque el gym no tenga facturación activa', async () => {
      const clientId = await crearSocio({
        documento: '51000006',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-02-01',
      });

      // El gym ni siquiera existe en la base: la facturación no puede resolverse.
      // El evento tiene que quedar igual — el KPI no depende de que AFIP conteste.
      await auth(request(app).post(`/api/clients/${clientId}/renew`))
        .send({ monto: 30000 })
        .expect(200);

      const eventos = await eventosDe(clientId);
      expect(eventos.filter((e) => e.tipo === 'renovacion')).toHaveLength(1);
    });

    it('el socio eliminado sale del cálculo sin contar como baja', async () => {
      const { a } = await sembrarEscenario();

      const antes = await pedirKpis(FEBRERO);
      expect(antes.socios.bajasEnPeriodo).toBe(1);

      await auth(request(app).delete(`/api/clients/${a}`)).expect(200);

      // Borrado lógico, no baja de negocio: desaparece del cálculo entero.
      const despues = await pedirKpis(FEBRERO);
      expect(despues.socios.bajasEnPeriodo).toBe(0);
      expect(despues.retencion.churnMensual).toBe(0);
    });
  });

  describe('financieros', () => {
    it('suma los ingresos de las renovaciones del período, en centavos', async () => {
      const clientId = await crearSocio({
        documento: '52000001',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-12-31',
      });

      await auth(request(app).post(`/api/clients/${clientId}/renew`))
        .send({ monto: 30000 })
        .expect(200);

      // La renovación se fecha ahora, así que cae en el mes en curso (el default).
      const kpis = await pedirKpis();

      // La base guarda pesos; el dominio razona en centavos.
      expect(kpis.financiero.ingresosPeriodo).toBe(3000000);
      expect(kpis.financiero.arpu).toBe(3000000);
      expect(kpis.financiero.mrr).toBeGreaterThan(0);
    });

    it('no cuenta como ingreso del período una renovación de otro mes', async () => {
      const clientId = await crearSocio({
        documento: '52000002',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-12-31',
      });

      await auth(request(app).post(`/api/clients/${clientId}/renew`))
        .send({ monto: 30000 })
        .expect(200);

      const kpis = await pedirKpis(FEBRERO);

      expect(kpis.financiero.ingresosPeriodo).toBe(0);
    });

    it('deja el MRR en cero mientras solo haya altas sin cobro', async () => {
      await sembrarEscenario();

      const kpis = await pedirKpis(FEBRERO);

      // El alta no lleva monto, así que no hay cuota de la que derivar el MRR.
      // Cero y no un número inventado: el dato todavía no existe.
      expect(kpis.financiero.mrr).toBe(0);
    });
  });

  describe('engagement', () => {
    it('deja el bloque en null mientras el gym no registre asistencias', async () => {
      await sembrarEscenario();

      const kpis = await pedirKpis(FEBRERO);

      expect(kpis.engagement.registroDesde).toBeNull();
      expect(kpis.engagement.visitasPorSocioPorSemana).toBeNull();
      // El día que se activa el módulo nadie tiene check-ins: marcar a todos como
      // "hace dos semanas que no vienen" sería un artefacto del sistema.
      expect(kpis.engagement.enRiesgo).toBeNull();
    });

    it('expone desde cuándo hay registro en cuanto entra la primera asistencia', async () => {
      const { b } = await sembrarEscenario();

      await auth(request(app).post('/api/checkins')).send({ clientId: b }).expect(201);

      const kpis = await pedirKpis();

      expect(kpis.engagement.registroDesde).not.toBeNull();
      // El registro arrancó hoy: el promedio semanal todavía no existe. Sin el piso,
      // dividir por 0,04 semanas devolvía números de dos dígitos —23,2 en el caso
      // real— y un número grande y preciso donde no se sabe engaña más que un hueco.
      expect(kpis.engagement.visitasPorSocioPorSemana).toBeNull();
      // Con menos de 14 días de registro todavía no se puede afirmar que alguien
      // lleva dos semanas sin venir.
      expect(kpis.engagement.enRiesgo).toBeNull();
    });

    /**
     * Los socios en riesgo, con nombre.
     *
     * La asistencia se siembra hace 20 días para que el gym supere los 14 de registro
     * que habilitan la métrica: sin eso `enRiesgo` viene en `null` y no hay nada que
     * verificar.
     */
    it('devuelve los socios en riesgo con nombre y sin `clientIds`', async () => {
      const { b } = await sembrarEscenario();

      const hace20Dias = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      await auth(request(app).post('/api/checkins'))
        .send({ clientId: b, fecha: hace20Dias.toISOString() })
        .expect(201);

      const kpis = await pedirKpis();

      expect(kpis.engagement.enRiesgo).not.toBeNull();
      // `clientIds` duplicaba a `socios` durante la migración del front y salió el
      // 09/08. Que la clave no vuelva es parte del contrato.
      expect(Object.keys(kpis.engagement.enRiesgo).sort()).toEqual(['socios', 'total']);

      for (const socio of kpis.engagement.enRiesgo.socios) {
        expect(socio.nombre).toBeTruthy();
      }
    });
  });

  describe('GET /api/dashboard (refactorizado)', () => {
    it('sigue devolviendo el resumen del gym', async () => {
      await sembrarEscenario();

      const res = await auth(request(app).get('/api/dashboard')).expect(200);

      expect(res.body.status).toBe('success');
      // El refactor pasó los conteos a la base en vez de traer 1000 clientes: lo que
      // importa es que el contrato con el front no se movió.
      expect(Object.keys(res.body.data).sort()).toEqual([
        'clientesActivos',
        'clientesRecurrentes',
        'ingresos',
        'rutinasPorVencer',
        'rutinasSinEnviar',
      ]);
      // Uno solo. El escenario tiene dos socios no eliminados, pero A venció el
      // 01/02 y nunca renovó: `clientesActivos` cuenta membresías vigentes o en
      // gracia, no registros sin borrar.
      expect(res.body.data.clientesActivos).toBe(1);
      expect(res.body.data.clientesRecurrentes).toBe(0);
      expect(res.body.data.rutinasPorVencer).toEqual({ en7Dias: 0, en5Dias: 0, en3Dias: 0 });
      expect(res.body.data.ingresos.mesActual).toBe(0);
    });

    /**
     * El contrato que fija este archivo y ningún otro puede fijar: los dos endpoints
     * viven en la misma pantalla y tienen que contar lo mismo.
     *
     * `/dashboard` cuenta por `fechaVencimiento` y `/dashboard/kpis` reconstruye las
     * ventanas desde el stream de eventos. Son dos caminos distintos hacia la misma
     * pregunta —"¿está activo hoy?"— y coinciden mientras `fechaVencimiento` siga
     * sincronizada con la última renovación. Es la única prueba que detecta que
     * vuelvan a separarse: hasta el 09/08 uno decía 3 y el otro 2 en la misma vista.
     */
    it('cuenta los mismos socios activos que GET /dashboard/kpis', async () => {
      await sembrarEscenario();

      const [dashboard, kpis] = await Promise.all([
        auth(request(app).get('/api/dashboard')).expect(200),
        auth(request(app).get('/api/dashboard/kpis')).expect(200),
      ]);

      expect(dashboard.body.data.clientesActivos).toBe(kpis.body.data.socios.activos);
    });

    it('devuelve rutinasSinEnviar como número: un 0 acá es un dato real', async () => {
      await sembrarEscenario();

      const res = await auth(request(app).get('/api/dashboard')).expect(200);

      // El front pintaba un guión porque el campo no existía. Ahora existe, y su 0
      // afirma algo cierto: no hay ninguna rutina trabada sin enviar.
      expect(res.body.data.rutinasSinEnviar).toBe(0);
      expect(res.body.data.rutinasSinEnviar).not.toBeNull();
    });

    it('cuenta como recurrente al socio que ya renovó', async () => {
      const clientId = await crearSocio({
        documento: '53000001',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-12-31',
      });

      // `esRecurrente` se enciende a partir de la segunda renovación.
      await auth(request(app).post(`/api/clients/${clientId}/renew`))
        .send({ monto: 30000 })
        .expect(200);
      await auth(request(app).post(`/api/clients/${clientId}/renew`))
        .send({ monto: 30000 })
        .expect(200);

      const res = await auth(request(app).get('/api/dashboard')).expect(200);

      expect(res.body.data.clientesRecurrentes).toBe(1);
    });

    it('no cuenta los clientes de otro gym', async () => {
      await sembrarEscenario();

      const res = await request(app)
        .get('/api/dashboard')
        .set('Authorization', `Bearer ${tokenDe(otroGymId)}`)
        .expect(200);

      expect(res.body.data.clientesActivos).toBe(0);
    });
  });

  /**
   * La serie mensual: lo que reemplaza las 12 llamadas en paralelo que el front hacía
   * para dibujar una gráfica de 12 puntos.
   *
   * Lo que se verifica acá y no en el test del caso de uso es el CONTRATO: el formato
   * de fecha sin hora, la unidad de los montos y que el punto del mes en curso
   * coincida con `/dashboard/kpis`. Ese último es el que importa: dos pantallas que
   * muestran el mismo mes tienen que mostrar el mismo número, o nadie sabe cuál creer.
   */
  describe('GET /api/dashboard/kpis/series', () => {
    const pedirSerie = async (query: Record<string, string> = {}) => {
      const res = await auth(
        request(app).get('/api/dashboard/kpis/series').query(query)
      ).expect(200);
      return res.body.data;
    };

    it('devuelve exactamente los meses pedidos, del más viejo al más nuevo', async () => {
      await sembrarEscenario();

      const serie = await pedirSerie({ meses: '6' });

      expect(serie.puntos).toHaveLength(6);

      const meses = serie.puntos.map((p: { mes: string }) => p.mes);
      expect([...meses].sort()).toEqual(meses);
    });

    it('usa 12 meses por defecto', async () => {
      await sembrarEscenario();

      const serie = await pedirSerie();

      expect(serie.puntos).toHaveLength(12);
    });

    it('devuelve el punto con la forma exacta que pidió el front', async () => {
      await sembrarEscenario();

      const serie = await pedirSerie({ meses: '3' });

      expect(Object.keys(serie).sort()).toEqual(['datosCompletosDesde', 'puntos']);
      expect(Object.keys(serie.puntos[0]).sort()).toEqual([
        'altas',
        'bajas',
        'churnMensual',
        'crecimientoNeto',
        'desde',
        'hasta',
        'ingresos',
        'mes',
        'mrr',
        'tasaRetencion',
      ]);
    });

    /**
     * La regla es el significado del campo, no el endpoint donde aparece.
     *
     * Un **límite de período** es una medianoche sin hora significativa y viaja como
     * `yyyy-MM-dd`. Un **instante** —el momento de la siembra, la primera asistencia—
     * lleva la hora adentro del dato y viaja como ISO completo. Mezclarlos no es
     * cosmético: una fecha de calendario formateada como instante se muestra corrida
     * un día en UTC−3, y un día es la diferencia entre llamar a un socio y no
     * llamarlo.
     *
     * Este test pedía `yyyy-MM-dd` también para `datosCompletosDesde`, que es un
     * instante. El criterio quedó cerrado al revés y unificado entre los dos
     * endpoints de KPIs (ver `DashboardController`).
     */
    it('manda los límites de período sin hora y los instantes con hora', async () => {
      await sembrarEscenario();

      const serie = await pedirSerie({ meses: '3' });

      for (const punto of serie.puntos) {
        expect(punto.mes).toMatch(/^\d{4}-\d{2}$/);
        expect(punto.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(punto.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      expect(serie.datosCompletosDesde).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z$/);
    });

    it('devuelve `datosCompletosDesde` en el mismo formato que /dashboard/kpis', async () => {
      await sembrarEscenario();

      const [serie, kpis] = await Promise.all([pedirSerie({ meses: '3' }), pedirKpis()]);

      // Los dos endpoints muestran el mismo campo en la misma pantalla. Que uno lo
      // mandara como fecha y el otro como instante obligaba al front a adivinar cuál
      // estaba leyendo.
      expect(typeof serie.datosCompletosDesde).toBe(typeof kpis.datosCompletosDesde);
      expect(serie.datosCompletosDesde).toBe(kpis.datosCompletosDesde);
    });

    it('el rango es semiabierto: el `hasta` de un mes es el `desde` del siguiente', async () => {
      await sembrarEscenario();

      const serie = await pedirSerie({ meses: '4' });

      for (let i = 0; i < serie.puntos.length - 1; i += 1) {
        expect(serie.puntos[i].hasta).toBe(serie.puntos[i + 1].desde);
      }
    });

    it('el `desde` de cada punto es siempre un día 1', async () => {
      await sembrarEscenario();

      const serie = await pedirSerie({ meses: '12' });

      for (const punto of serie.puntos) {
        expect(punto.desde.endsWith('-01')).toBe(true);
        expect(punto.mes).toBe(punto.desde.slice(0, 7));
      }
    });

    /**
     * La coherencia entre los dos endpoints, que es lo que evita el bug más caro:
     * que la tarjeta y la gráfica del mismo mes muestren números distintos.
     */
    it('el punto del mes en curso coincide con /dashboard/kpis sin parámetros', async () => {
      await sembrarEscenario();

      const kpis = await pedirKpis();
      const serie = await pedirSerie({ meses: '1' });

      const mesEnCurso = serie.puntos[0];

      expect(mesEnCurso.ingresos).toBe(kpis.financiero.ingresosPeriodo);
      expect(mesEnCurso.mrr).toBe(kpis.financiero.mrr);
      expect(mesEnCurso.altas).toBe(kpis.socios.altasEnPeriodo);
      expect(mesEnCurso.bajas).toBe(kpis.socios.bajasEnPeriodo);
      expect(mesEnCurso.crecimientoNeto).toBe(kpis.socios.crecimientoNeto);

      // Los dos endpoints resuelven el mismo período por default —mes en curso,
      // cortado en UTC— así que la gráfica y la tarjeta de retención tienen que dar
      // el mismo número. Es la única aserción que detecta que se separen.
      expect(mesEnCurso.churnMensual).toBe(kpis.retencion.churnMensual);
      expect(mesEnCurso.tasaRetencion).toBe(kpis.retencion.tasaRetencion);
    });

    /**
     * La cohorte de 90 días es móvil y se mide contra `now`, no contra el mes: el
     * mismo valor repetido doce veces se leería como una evolución que no ocurrió.
     * Queda deliberadamente fuera del punto, y esto lo fija para que no entre "por
     * simetría" con los otros dos campos de retención.
     */
    it('no lleva la cohorte de 90 días en el punto', async () => {
      await sembrarEscenario();

      const serie = await pedirSerie({ meses: '3' });

      expect(serie.puntos[0]).not.toHaveProperty('cohorte90Dias');
    });

    it('los montos van en centavos, igual que el bloque financiero', async () => {
      const clientId = await crearSocio({
        documento: '54000001',
        fechaInicio: '2026-01-01',
        fechaVencimiento: '2026-12-31',
      });

      // 30.000 pesos: en centavos son 3.000.000.
      await auth(request(app).post(`/api/clients/${clientId}/renew`))
        .send({ monto: 30000 })
        .expect(200);

      const serie = await pedirSerie({ meses: '1' });

      expect(serie.puntos[0].ingresos).toBe(3_000_000);
    });

    it('devuelve los meses vacíos igual, no los omite', async () => {
      await sembrarEscenario();

      const serie = await pedirSerie({ meses: '24' });

      // Ningún hueco: 24 puntos, todos con su mes, aunque el gym no exista hace 24
      // meses. Un mes ausente dibuja una recta que atraviesa el hueco.
      expect(serie.puntos).toHaveLength(24);
      expect(new Set(serie.puntos.map((p: { mes: string }) => p.mes)).size).toBe(24);
    });

    it('un gym sin datos devuelve la serie completa, no un array vacío', async () => {
      const res = await request(app)
        .get('/api/dashboard/kpis/series')
        .set('Authorization', `Bearer ${tokenDe(otroGymId)}`)
        .expect(200);

      expect(res.body.data.datosCompletosDesde).toBeNull();
      expect(res.body.data.puntos).toHaveLength(12);
      expect(
        res.body.data.puntos.every((p: { bajas: number | null }) => p.bajas === null)
      ).toBe(true);
    });

    describe('validación de `meses`', () => {
      it.each([['0'], ['-3'], ['25'], ['abc'], ['1.5']])(
        'rechaza meses=%s con 400',
        async (meses) => {
          await auth(request(app).get('/api/dashboard/kpis/series').query({ meses })).expect(
            400
          );
        }
      );

      it('acepta el techo de 24', async () => {
        const serie = await pedirSerie({ meses: '24' });
        expect(serie.puntos).toHaveLength(24);
      });
    });

    it('no mezcla los datos de otro gym', async () => {
      await sembrarEscenario();

      const res = await request(app)
        .get('/api/dashboard/kpis/series')
        .set('Authorization', `Bearer ${tokenDe(otroGymId)}`)
        .expect(200);

      expect(
        res.body.data.puntos.every((p: { ingresos: number }) => p.ingresos === 0)
      ).toBe(true);
    });

    it('exige autenticación (401)', async () => {
      await request(app).get('/api/dashboard/kpis/series').expect(401);
    });

    it('el admin sin ?gymId no tiene tenant que resolver (400)', async () => {
      const adminToken = jwt.sign(
        { userId: 'admin-1', email: 'admin@hype.com', role: 'admin' },
        env.JWT_ACCESS_SECRET
      );

      await request(app)
        .get('/api/dashboard/kpis/series')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });
});

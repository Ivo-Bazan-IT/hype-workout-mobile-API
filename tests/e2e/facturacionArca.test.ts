import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

/*
 * ARCA/AFIP intervenido a nivel HTTP.
 *
 * Se mockea `axios` y no el `IInvoiceProvider` a propósito: mockear el puerto
 * probaría que el caso de uso llama a algo, pero no QUÉ comprobante se arma. El
 * armado del payload fiscal —tipo de comprobante, desglose de IVA, CUIT del
 * emisor— vive en `AfipSdkAdapter`, así que cortar más arriba dejaría sin probar
 * justo lo que hay que verificar antes de apuntar al homologación real.
 *
 * `vi.hoisted` porque `vi.mock` se iza por encima de los imports: sin esto, la
 * fábrica del mock referenciaría una variable todavía sin inicializar.
 */
const arca = vi.hoisted(() => ({
  recibido: [] as { body: any; authorization?: string }[],
  /** Se reasigna por test para simular la respuesta de ARCA. */
  responder: (_body: any): any => ({}),
}));

vi.mock('axios', async (importActual) => {
  const actual = await importActual<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: (config: any) => ({
        post: async (_url: string, body: any) => {
          arca.recibido.push({ body, authorization: config?.headers?.Authorization });
          return { data: arca.responder(body) };
        },
      }),
    },
  };
});

/*
 * Este archivo prueba el modo `cuenta_unica` (una sola cuenta de AFIP SDK para
 * todos los gyms) a propósito: quedó DESCONECTADO por default (ver
 * `AFIP_BILLING_MODE` en env.ts), pero el código sigue intacto por si se
 * retoma, y este es el e2e que lo sostiene. Tiene que fijarse ANTES del import
 * dinámico de abajo: `env` se parsea una sola vez, al importarse.
 */
process.env.AFIP_BILLING_MODE = 'cuenta_unica';

const { createApp } = await import('../../src/app');
const { env } = await import('../../src/config/env');
const { GymTaxCondition } = await import('../../src/domain/billing/types');

/**
 * El circuito de facturación completo, con ARCA mockeado.
 *
 * Cubre el viaje que ningún otro test hace entero: renovar un socio → la factura
 * queda encolada → el disparador la emite → el comprobante persiste con su CAE.
 * Los tests de `EmitPendingInvoicesUseCase` prueban ese eslabón con mocks, y
 * `invoices.test.ts` prueba el historial ya emitido; en el medio no había nada.
 *
 * Se afirma **comportamiento fiscal**, no la forma cruda del JSON: que un
 * monotributista no discrimine IVA y un responsable inscripto sí, que el
 * comprobante sea el que corresponde al régimen, y que el neto más el IVA cierren
 * exactamente contra lo que el socio pagó —que es la condición que ARCA rechaza
 * si no da al centavo—.
 */
describe('Facturación ARCA de punta a punta (e2e, modo cuenta_unica desconectado)', () => {
  let app: Application;
  let contador = 0;

  const adminToken = jwt.sign(
    { userId: 'admin-1', email: 'admin@hype.com', role: 'admin' },
    env.JWT_ACCESS_SECRET
  );

  /** DNI de 7 dígitos: `normalizarDocumento` los acepta (hay documentos viejos así). */
  const DNI_SOCIO = '7654321';
  /** La cuenta de AFIP SDK es única: la fija tests/setup.ts en el entorno. */
  const API_KEY_PLATAFORMA = env.AFIP_SDK_API_KEY;

  /**
   * Deja un gimnasio listo para facturar bajo el régimen pedido, con un socio
   * cargado. Va por la API real —alta, configuración de AFIP, alta de socio— para
   * que el test recorra el mismo camino que la aplicación.
   *
   * `fiscal` permite montar dos gimnasios con identidades distintas en el mismo
   * test; omitido, usa la de siempre para no tocar los casos de un solo gym.
   */
  const montarGymFacturable = async (
    taxCondition: string,
    fiscal: { cuit?: string; puntoVenta?: number } = {}
  ) => {
    contador += 1;

    const altaGym = await request(app)
      .post('/api/admin/gyms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Hype ARCA ${contador}`,
        businessName: `Hype ARCA ${contador} SRL`,
        // 11 dígitos: es lo único que `normalizarCuit` acepta. Se carga CON guiones
        // para que el test verifique también que viajan normalizados.
        cuit: `30-7123456${contador}-1`.replace(/(\d)-(\d)/, '$1$2'),
        contactEmail: `arca${contador}@hype.com`,
        contactPhone: '5491122334455',
        adminEmail: `arcadueno${contador}@hype.com`,
        adminPassword: 'secret123',
        adminName: `Dueño ARCA ${contador}`,
      })
      .expect(201);

    const gymId = altaGym.body.data.gym.id;
    const gymToken = jwt.sign(
      { userId: `user-${contador}`, email: `arcadueno${contador}@hype.com`, role: 'gym', gymId },
      env.JWT_ACCESS_SECRET
    );
    const asGym = (req: request.Test) => req.set('Authorization', `Bearer ${gymToken}`);

    await asGym(request(app).put('/api/gyms/settings/afip'))
      .send({
        cuit: fiscal.cuit ?? '30712345671',
        puntoVenta: fiscal.puntoVenta ?? 4,
        taxCondition,
        isActive: true,
      })
      .expect(200);

    const altaSocio = await asGym(request(app).post('/api/clients'))
      .send({ nombre: `Socio ARCA ${contador}`, documento: DNI_SOCIO })
      .expect(201);

    return { gymId, asGym, clientId: altaSocio.body.data.id };
  };

  /** Dispara la emisión por el mismo endpoint que va a usar el cron en producción. */
  const emitirPendientes = () =>
    request(app)
      .post('/api/internal/jobs/emit-invoices')
      .set('x-internal-secret', env.INVOICE_CRON_SECRET!);

  /** Deja a la vista el comprobante que se le mandaría a ARCA y el que quedó guardado. */
  const mostrarComprobante = (etiqueta: string, enviado: any, guardado: any) => {
    console.log(
      `\n──── ${etiqueta} ────\n` +
        `A ARCA:   ${JSON.stringify(enviado, null, 2)}\n` +
        `Guardado: ${JSON.stringify(
          {
            tipoComprobante: guardado.tipoComprobante,
            estado: guardado.estado,
            cae: guardado.cae,
            numeroComprobante: guardado.numeroComprobante,
            puntoVenta: guardado.puntoVenta,
            neto: guardado.neto,
            iva: guardado.iva,
            monto: guardado.monto,
          },
          null,
          2
        )}\n`
    );
  };

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(() => {
    arca.recibido = [];
    // ARCA devuelve el comprobante que efectivamente registró: se le hace eco al
    // tipo y al punto de venta pedidos, que es como se comporta el servicio real.
    arca.responder = (body: any) => ({
      cae: '75123456789012',
      vencimiento_cae: '20261231',
      numero_comprobante: 1,
      punto_venta: body.punto_venta,
      tipo_comprobante: body.tipo_comprobante,
    });
  });

  it('monotributista: emite Factura C y no discrimina IVA', async () => {
    const { asGym, clientId } = await montarGymFacturable(GymTaxCondition.MONOTRIBUTO);

    // 1. Renovar NO habla con ARCA: deja el comprobante encolado y responde.
    await asGym(request(app).post(`/api/clients/${clientId}/renew`))
      .send({ monto: 15000 })
      .expect(200);

    expect(arca.recibido).toHaveLength(0);

    const encolada = await asGym(request(app).get('/api/invoices')).expect(200);
    expect(encolada.body.data.data[0].estado).toBe('pendiente');
    expect(encolada.body.data.data[0].tipoComprobante).toBe('Factura C');

    // 2. El disparador la emite.
    const corrida = await emitirPendientes().expect(200);
    expect(corrida.body.data).toMatchObject({ procesadas: 1, emitidas: 1, fallidas: 0 });

    // 3. Lo que se le pidió a ARCA.
    expect(arca.recibido).toHaveLength(1);
    const enviado = arca.recibido[0].body;

    // Código 11 = Factura C, la que le corresponde a un monotributista.
    expect(enviado.tipo_comprobante).toBe(11);

    /*
     * `AFIP_SDK_ENVIRONMENT=dev` lo fija tests/setup.ts: homologación. Es la
     * salvaguarda que impide que una corrida de tests emita comprobantes reales
     * ante ARCA, que no se borran — se anulan con nota de crédito. Viaja desde
     * el entorno hasta el body sin que nadie lo reinterprete en el medio.
     */
    expect(enviado.environment).toBe('dev');

    // El monotributista NO discrimina IVA: el neto es el total y no hay IVA.
    expect(enviado.importe_iva).toBe(0);
    expect(enviado.importe_neto).toBe(15000);
    expect(enviado.importe_total).toBe(15000);

    // El CUIT del emisor viaja entero y como número: cargado con guiones, un
    // `parseInt` ingenuo devolvía `30` y facturaba a nombre de cualquiera.
    expect(enviado.cuit).toBe(30712345671);

    // El socio es consumidor final con DNI de 7 dígitos (tipo 96 = DNI).
    expect(enviado.tipo_documento).toBe(96);
    expect(enviado.numero_documento).toBe(7654321);

    /*
     * La credencial que viaja es la de la plataforma. El gimnasio no carga
     * ninguna: lo suyo es la identidad fiscal —CUIT y punto de venta, ya
     * verificados arriba—, no la cuenta con el proveedor del SDK.
     */
    expect(arca.recibido[0].authorization).toBe(`Bearer ${API_KEY_PLATAFORMA}`);

    // 4. El comprobante quedó guardado con lo que ARCA devolvió.
    const historial = await asGym(request(app).get('/api/invoices')).expect(200);
    const guardado = historial.body.data.data[0];

    expect(guardado.estado).toBe('emitida');
    expect(guardado.cae).toBe('75123456789012');
    expect(guardado.tipoComprobante).toBe('Factura C');
    expect(guardado.puntoVenta).toBe(4);

    mostrarComprobante('MONOTRIBUTO → Factura C', enviado, guardado);
  });

  it('responsable inscripto: emite Factura B y desagrega el IVA sin perder centavos', async () => {
    const { asGym, clientId } = await montarGymFacturable(GymTaxCondition.RESPONSABLE_INSCRIPTO);

    // Monto elegido a propósito: 15000/1.21 no da redondo, así que si el neto y el
    // IVA se calcularan por separado la suma no cerraría contra el total.
    await asGym(request(app).post(`/api/clients/${clientId}/renew`))
      .send({ monto: 15000 })
      .expect(200);

    expect(arca.recibido).toHaveLength(0);

    const encolada = await asGym(request(app).get('/api/invoices')).expect(200);
    expect(encolada.body.data.data[0].estado).toBe('pendiente');
    expect(encolada.body.data.data[0].tipoComprobante).toBe('Factura B');

    const corrida = await emitirPendientes().expect(200);
    expect(corrida.body.data).toMatchObject({ procesadas: 1, emitidas: 1, fallidas: 0 });

    expect(arca.recibido).toHaveLength(1);
    const enviado = arca.recibido[0].body;

    // Código 6 = Factura B, la del responsable inscripto a consumidor final.
    expect(enviado.tipo_comprobante).toBe(6);

    // Acá sí se discrimina IVA, y el total sigue siendo lo que el socio pagó: el
    // precio lo lleva incluido, no se le suma encima.
    expect(enviado.importe_total).toBe(15000);
    expect(enviado.importe_iva).toBeGreaterThan(0);
    expect(enviado.importe_neto).toBeLessThan(15000);

    // La condición que ARCA rechaza si no cierra: neto + IVA da EXACTO el total.
    expect(Number((enviado.importe_neto + enviado.importe_iva).toFixed(2))).toBe(15000);

    /*
     * El IVA es el 21% "casi" exacto, y esa diferencia es deliberada: el adaptador
     * lo calcula por RESTA (`total - neto`), no multiplicando el neto por 0.21.
     * Con 15000 el neto redondeado es 12396.69 y el 21% puro daría 2603.3049,
     * medio centavo menos que el 2603.31 que se informa. Se elige que la suma
     * cierre exacto —lo que ARCA valida— por sobre que el porcentaje lo haga.
     * Si esta aserción se pusiera estricta, estaría pidiendo el bug de vuelta.
     */
    expect(enviado.importe_iva).toBeCloseTo(enviado.importe_neto * 0.21, 1);
    expect(Math.abs(enviado.importe_iva - enviado.importe_neto * 0.21)).toBeLessThan(0.01);

    // Mismo emisor y mismo socio que en el otro régimen: lo único que cambia es el
    // comprobante y el desglose.
    expect(enviado.cuit).toBe(30712345671);
    expect(enviado.numero_documento).toBe(7654321);

    // Concepto 2 = Servicios, que exige las fechas de servicio en formato YYYYMMDD.
    expect(enviado.concepto).toBe(2);
    expect(enviado.fecha_servicio_desde).toMatch(/^\d{8}$/);

    const historial = await asGym(request(app).get('/api/invoices')).expect(200);
    const guardado = historial.body.data.data[0];

    expect(guardado.estado).toBe('emitida');
    expect(guardado.cae).toBe('75123456789012');
    expect(guardado.tipoComprobante).toBe('Factura B');
    // El desglose se persiste: sin esto no se puede auditar ni reimprimir.
    expect(Number((guardado.neto + guardado.iva).toFixed(2))).toBe(15000);

    mostrarComprobante('RESPONSABLE INSCRIPTO → Factura B', enviado, guardado);
  });

  /*
   * Dos contribuyentes distintos bajo UNA sola cuenta de AFIP SDK.
   *
   * Es la prueba del modelo que se eligió al sacar la credencial por gimnasio: la
   * cuenta con el proveedor es de la plataforma y lo que distingue a un tenant de
   * otro es su identidad fiscal. Los otros dos casos montan un gym por vez, así
   * que un adaptador que se quedara con el CUIT del primero —cacheado, o resuelto
   * una sola vez al arrancar— pasaría igual: acá no.
   *
   * Los dos comprobantes salen en la MISMA pasada del worker y a propósito son de
   * regímenes opuestos, porque lo que varía por gym no es solo el CUIT: también el
   * punto de venta, el tipo de comprobante y si el IVA se desagrega o no.
   */
  it('dos gimnasios con CUIT y régimen distintos facturan en la misma corrida', async () => {
    // Se carga con guiones y sin guiones para cubrir las dos formas de entrada.
    const monotributista = await montarGymFacturable(GymTaxCondition.MONOTRIBUTO, {
      cuit: '30-11111111-1',
      puntoVenta: 4,
    });
    const inscripto = await montarGymFacturable(GymTaxCondition.RESPONSABLE_INSCRIPTO, {
      cuit: '27222222222',
      puntoVenta: 12,
    });

    await monotributista
      .asGym(request(app).post(`/api/clients/${monotributista.clientId}/renew`))
      .send({ monto: 15000 })
      .expect(200);

    // 24200 tiene neto e IVA exactos (20000 + 4200): el redondeo ya lo cubre el
    // caso de responsable inscripto, acá estorbaría para leer la comparación.
    await inscripto
      .asGym(request(app).post(`/api/clients/${inscripto.clientId}/renew`))
      .send({ monto: 24200 })
      .expect(200);

    // Una sola pasada del worker drena las dos facturas.
    const corrida = await emitirPendientes().expect(200);
    expect(corrida.body.data).toMatchObject({ procesadas: 2, emitidas: 2, fallidas: 0 });

    expect(arca.recibido).toHaveLength(2);

    /*
     * Se busca por CUIT y no por posición: en qué orden el worker toma las
     * facturas de la cola no es parte del contrato, y atarlo haría fallar el test
     * por un cambio que no rompe nada.
     */
    const comprobanteDe = (cuit: number) => {
      const pedido = arca.recibido.find((r) => r.body.cuit === cuit);
      expect(pedido, `ARCA no recibió ningún comprobante con CUIT ${cuit}`).toBeDefined();
      return pedido!;
    };

    const deMonotributista = comprobanteDe(30111111111);
    const deInscripto = comprobanteDe(27222222222);

    // Cada uno factura con lo suyo: código 11 = Factura C (no discrimina IVA),
    // código 6 = Factura B (lo desagrega del precio, que ya lo lleva incluido).
    expect(deMonotributista.body).toMatchObject({
      cuit: 30111111111,
      punto_venta: 4,
      tipo_comprobante: 11,
      importe_total: 15000,
      importe_neto: 15000,
      importe_iva: 0,
    });

    expect(deInscripto.body).toMatchObject({
      cuit: 27222222222,
      punto_venta: 12,
      tipo_comprobante: 6,
      importe_total: 24200,
      importe_neto: 20000,
      importe_iva: 4200,
    });

    /*
     * El núcleo del test: dos CUIT emisores distintos viajando con la MISMA
     * credencial. Si AFIP SDK no admitiera varios contribuyentes por cuenta, es
     * exactamente acá donde el modelo se cae —y se va a ver contra homologación,
     * no contra este mock, que acepta cualquier cosa—.
     */
    expect(deMonotributista.body.cuit).not.toBe(deInscripto.body.cuit);
    expect(deMonotributista.authorization).toBe(`Bearer ${API_KEY_PLATAFORMA}`);
    expect(deInscripto.authorization).toBe(`Bearer ${API_KEY_PLATAFORMA}`);

    // Y los dos contra homologación: que sean varios no relaja la salvaguarda.
    expect(deMonotributista.body.environment).toBe('dev');
    expect(deInscripto.body.environment).toBe('dev');

    /*
     * Cada historial ve solo lo suyo. Emitir en la misma corrida no puede filtrar
     * el comprobante de un gimnasio al otro: además de un bug de aislamiento,
     * sería exponer la facturación de un cliente a otro.
     */
    const historialMono = await monotributista
      .asGym(request(app).get('/api/invoices'))
      .expect(200);
    const historialInscripto = await inscripto
      .asGym(request(app).get('/api/invoices'))
      .expect(200);

    expect(historialMono.body.data.data).toHaveLength(1);
    expect(historialMono.body.data.data[0]).toMatchObject({
      estado: 'emitida',
      tipoComprobante: 'Factura C',
      puntoVenta: 4,
      monto: 15000,
    });

    expect(historialInscripto.body.data.data).toHaveLength(1);
    expect(historialInscripto.body.data.data[0]).toMatchObject({
      estado: 'emitida',
      tipoComprobante: 'Factura B',
      puntoVenta: 12,
      neto: 20000,
      iva: 4200,
    });

    mostrarComprobante(
      'MULTI-CUIT · monotributista',
      deMonotributista.body,
      historialMono.body.data.data[0]
    );
    mostrarComprobante(
      'MULTI-CUIT · responsable inscripto',
      deInscripto.body,
      historialInscripto.body.data.data[0]
    );
  });
});

/**
 * Hype Workout CRM — envío de las respuestas del formulario de ingreso.
 *
 * Este código se instala del lado de Google (Apps Script), NO en el backend.
 * Google Forms no tiene webhooks nativos: es el formulario el que tiene que
 * avisarle al CRM, no al revés.
 *
 * Guía de instalación paso a paso: ver README.md en esta misma carpeta.
 */

// ---------------------------------------------------------------------------
// Configuración
//
// Los tres valores se cargan en «Configuración del proyecto → Propiedades del
// script», NO acá adentro. El código del script lo puede leer cualquiera con
// permiso de edición sobre el formulario, y el secreto no puede vivir ahí.
// ---------------------------------------------------------------------------

var CLAVE_URL = 'CRM_WEBHOOK_URL';
var CLAVE_GYM_ID = 'CRM_GYM_ID';
var CLAVE_SECRET = 'CRM_WEBHOOK_SECRET';

/** Reintentos ante fallas transitorias del backend. */
var MAX_INTENTOS = 3;
var ESPERA_INICIAL_MS = 2000;

// ---------------------------------------------------------------------------
// Punto de entrada: lo llama el trigger onFormSubmit
// ---------------------------------------------------------------------------

function onFormSubmit(e) {
  var config = leerConfiguracion();
  var respuestas = extraerRespuestas(e);

  if (Object.keys(respuestas).length === 0) {
    throw new Error(
      'El formulario se envió vacío: no hay nada que mandarle al CRM.'
    );
  }

  enviarAlCrm(config, respuestas, extraerResponseId(e));
}

/**
 * Id que Google le dio a esta respuesta. Es lo que hace idempotente al webhook:
 * si el reintento de abajo manda dos veces la misma respuesta, el CRM la reconoce
 * y no la vuelve a aplicar.
 *
 * Solo existe con el trigger instalado sobre el FORMULARIO. Sobre la hoja de
 * respuestas no hay `FormResponse`, así que se manda sin id y el CRM procesa igual
 * — perder el dato del socio es peor que perder la deduplicación.
 */
function extraerResponseId(e) {
  if (e && e.response && typeof e.response.getId === 'function') {
    return e.response.getId();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Lectura de las respuestas
// ---------------------------------------------------------------------------

/**
 * Soporta las dos formas de instalar el trigger, porque el objeto del evento es
 * distinto en cada una y elegir mal es el error de instalación más común:
 *
 *  - sobre el FORMULARIO  → `e.response` (un FormResponse). Es la recomendada:
 *    no necesita que exista una hoja de respuestas vinculada.
 *  - sobre la HOJA de respuestas → `e.namedValues`.
 */
function extraerRespuestas(e) {
  if (!e) {
    throw new Error(
      'No llegó el evento del formulario. Si estás probando desde el editor, ' +
        'no uses el botón ▶ sobre onFormSubmit: usá probarEnvio().'
    );
  }

  if (e.response && typeof e.response.getItemResponses === 'function') {
    return respuestasDesdeFormulario(e.response);
  }

  if (e.namedValues) {
    return respuestasDesdeHoja(e.namedValues);
  }

  throw new Error(
    'El evento no trae respuestas. Revisá que el trigger sea de tipo ' +
      '"Al enviar el formulario" y no uno de tiempo.'
  );
}

function respuestasDesdeFormulario(formResponse) {
  var respuestas = {};
  var items = formResponse.getItemResponses();

  for (var i = 0; i < items.length; i++) {
    var titulo = items[i].getItem().getTitle();
    var valor = items[i].getResponse();

    // Las preguntas sin contestar no se mandan: un string vacío pisaría un dato
    // bueno de una carga anterior, porque el CRM fusiona respuestas.
    if (valor === '' || valor === null || valor === undefined) {
      continue;
    }

    respuestas[titulo] = valor;
  }

  return respuestas;
}

function respuestasDesdeHoja(namedValues) {
  var respuestas = {};

  Object.keys(namedValues).forEach(function (pregunta) {
    var valor = namedValues[pregunta];

    // La hoja entrega SIEMPRE arrays, incluso para respuestas de una sola línea.
    // Se desenvuelven las de un elemento para que el JSON que recibe el CRM sea
    // igual por los dos caminos de instalación.
    if (Object.prototype.toString.call(valor) === '[object Array]') {
      valor = valor.length === 1 ? valor[0] : valor;
    }

    if (valor === '' || valor === null || valor === undefined) {
      return;
    }

    respuestas[pregunta] = valor;
  });

  return respuestas;
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

function enviarAlCrm(config, respuestas, responseId) {
  var cuerpo = { gymId: config.gymId, respuestas: respuestas };

  // Solo se manda si existe: el CRM valida que, si viene, no sea cadena vacía.
  if (responseId) {
    cuerpo.responseId = responseId;
  }

  var opciones = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': config.secret },
    payload: JSON.stringify(cuerpo),
    // Sin esto, cualquier código >= 400 lanza una excepción y no se puede leer el
    // cuerpo de la respuesta, que es justo donde el CRM explica qué pasó.
    muteHttpExceptions: true
  };

  var espera = ESPERA_INICIAL_MS;

  for (var intento = 1; intento <= MAX_INTENTOS; intento++) {
    var respuesta = UrlFetchApp.fetch(config.url, opciones);
    var codigo = respuesta.getResponseCode();
    var cuerpoRespuesta = respuesta.getContentText();

    if (codigo >= 200 && codigo < 300) {
      Logger.log('✅ Respuestas enviadas al CRM (HTTP ' + codigo + '): ' + cuerpoRespuesta);
      return;
    }

    // 4xx (salvo 429) no se reintenta: el problema es del pedido, no del momento.
    // Reintentar un secreto mal cargado o un gym dado de baja solo gasta cuota.
    if (codigo >= 400 && codigo < 500 && codigo !== 429) {
      throw new Error(explicarError(codigo, cuerpoRespuesta));
    }

    // 5xx y 429 sí: el backend puede estar reiniciando o limitando por rate limit.
    // Reintentar es seguro — el CRM deduplica por el `responseId` que va en el
    // cuerpo, así que una respuesta que llegó pero cuya confirmación se perdió no
    // se vuelve a aplicar.
    if (intento < MAX_INTENTOS) {
      Logger.log(
        '⚠️ Intento ' + intento + ' falló (HTTP ' + codigo + '). Reintentando en ' +
          espera + 'ms.'
      );
      Utilities.sleep(espera);
      espera = espera * 2;
    }
  }

  throw new Error(
    'El CRM no respondió correctamente después de ' + MAX_INTENTOS +
      ' intentos. La respuesta quedó guardada en el formulario: se puede ' +
      'reenviar cargándola a mano en el panel del gimnasio.'
  );
}

/** Traduce el código HTTP a algo accionable para quien administra el gimnasio. */
function explicarError(codigo, cuerpo) {
  if (codigo === 401) {
    return (
      'HTTP 401: el CRM rechazó el secreto. Volvé a generarlo en el panel ' +
      '(Configuración → Google Forms → Rotar secreto) y actualizá la propiedad ' +
      CLAVE_SECRET + '. Detalle: ' + cuerpo
    );
  }

  if (codigo === 400) {
    return (
      'HTTP 400: el CRM rechazó los datos. Suele ser que el formulario no pregunta ' +
      'el DNI (es el único campo imprescindible: es la clave que une la respuesta ' +
      'con la ficha del socio) o que el gimnasio está desactivado. Detalle: ' + cuerpo
    );
  }

  if (codigo === 404) {
    // Dos causas muy distintas comparten el código, así que se distinguen por el
    // cuerpo. La del socio es la habitual y la que se resuelve sin tocar el script.
    if (cuerpo && cuerpo.indexOf('documento') !== -1) {
      return (
        'HTTP 404: no hay ningún socio con ese DNI en el gimnasio. El CRM NO crea ' +
        'clientes desde el formulario: primero se da de alta al socio en el panel y ' +
        'después contesta la encuesta. Revisá que el DNI esté bien tipeado o dalo ' +
        'de alta, y reenviá la respuesta desde el panel del formulario. Detalle: ' +
        cuerpo
      );
    }

    return (
      'HTTP 404: la URL del webhook no existe. Revisá la propiedad ' + CLAVE_URL +
      '; tiene que terminar en /api/onboarding/webhook. Detalle: ' + cuerpo
    );
  }

  return 'HTTP ' + codigo + ': ' + cuerpo;
}

// ---------------------------------------------------------------------------
// Utilidades de instalación (se ejecutan a mano desde el editor)
// ---------------------------------------------------------------------------

function leerConfiguracion() {
  var props = PropertiesService.getScriptProperties();

  var config = {
    url: props.getProperty(CLAVE_URL),
    gymId: props.getProperty(CLAVE_GYM_ID),
    secret: props.getProperty(CLAVE_SECRET)
  };

  var faltantes = [];
  if (!config.url) faltantes.push(CLAVE_URL);
  if (!config.gymId) faltantes.push(CLAVE_GYM_ID);
  if (!config.secret) faltantes.push(CLAVE_SECRET);

  if (faltantes.length > 0) {
    throw new Error(
      'Faltan propiedades del script: ' + faltantes.join(', ') +
        '. Cargalas en Configuración del proyecto → Propiedades del script.'
    );
  }

  return config;
}

/**
 * Ejecutar PRIMERO. Valida la configuración y, de paso, dispara el pedido de
 * permisos de Google (el trigger no puede autorizarse solo).
 */
function verificarConfiguracion() {
  var config = leerConfiguracion();

  Logger.log('URL:    ' + config.url);
  Logger.log('gymId:  ' + config.gymId);
  Logger.log('Secreto: cargado (' + config.secret.length + ' caracteres)');

  if (config.url.indexOf('/api/onboarding/webhook') === -1) {
    Logger.log('⚠️ La URL no termina en /api/onboarding/webhook. Revisala.');
  }
  if (config.url.indexOf('https://') !== 0) {
    Logger.log('⚠️ La URL no es HTTPS: el secreto viajaría en texto plano.');
  }

  Logger.log('✅ Configuración completa.');
}

/**
 * Instala el trigger sobre el formulario, borrando primero cualquiera anterior.
 *
 * Lo de borrar no es prolijidad: instalar el trigger dos veces hace que cada
 * respuesta se mande dos veces, y es el error más fácil de cometer si se corre
 * esta función más de una vez.
 */
function instalarTrigger() {
  var form = FormApp.getActiveForm();

  if (!form) {
    throw new Error(
      'No hay un formulario activo. Este script tiene que estar vinculado al ' +
        'Google Form (abrirlo desde el formulario → ⋮ → Editor de secuencias de comandos).'
    );
  }

  var existentes = ScriptApp.getProjectTriggers();
  var borrados = 0;

  for (var i = 0; i < existentes.length; i++) {
    if (existentes[i].getHandlerFunction() === 'onFormSubmit') {
      ScriptApp.deleteTrigger(existentes[i]);
      borrados++;
    }
  }

  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();

  Logger.log(
    '✅ Trigger instalado.' +
      (borrados > 0 ? ' Se borraron ' + borrados + ' trigger(s) duplicado(s).' : '')
  );
}

/**
 * Envío de prueba con las preguntas reales del formulario de inscripción.
 *
 * ⚠️ **Antes de correrlo, cambiá el DNI por el de un socio que EXISTA** en el
 * gimnasio. El CRM ya no crea clientes desde el formulario: si el DNI no está en la
 * base, esto devuelve 404 y no prueba nada. Y tené en cuenta que la encuesta del
 * socio que elijas se va a pisar con estos datos de prueba.
 *
 * Va sin `responseId` a propósito, para poder correrlo varias veces seguidas sin
 * que la idempotencia corte el segundo envío.
 */
function probarEnvio() {
  var config = leerConfiguracion();

  enviarAlCrm(
    config,
    {
      'Nombre completo': 'PRUEBA - Revisar',
      'DNI': 'CAMBIAR_POR_UN_DNI_QUE_EXISTA',
      'Numero de telefono': '5490000000000',
      'Edad': '30',
      'Objetivos con el entrenamiento': 'Ganar masa muscular',
      'Lesiones en curso': 'Ninguna',
      'Cantidad de dias a la semana que podra entrenar': '3 dias'
    },
    null
  );

  Logger.log(
    '✅ Envío de prueba OK. Revisá la ficha de ese socio: su encuesta quedó ' +
      'cargada con estos datos de prueba.'
  );
}
